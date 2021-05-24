import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ora from 'ora';
import { checkAirnodeParameters } from '../evm';
import { deployAirnode, removeAirnode } from '../infrastructure';
import {
  deriveAirnodeId,
  deriveMasterWalletAddress,
  deriveXpub,
  generateMnemonic,
  parseConfigFile,
  parseReceiptFile,
  parseSecretsFile,
  shortenAirnodeId,
  validateMnemonic,
  verifyMnemonic,
} from '../utils';
import { Receipts } from 'src/types';

export async function deploy(
  configFile: string,
  secretsFile: string,
  receiptFile: string,
  interactive: boolean,
  nodeVersion: string
) {
  const configs = parseConfigFile(configFile, nodeVersion);
  const secrets = parseSecretsFile(secretsFile);

  if (!secrets.MASTER_KEY_MNEMONIC) {
    ora().warn('If you already have a mnemonic, add it to your secrets.env file and restart the deployer');
    ora().info('Generating new mnemonic');
    const mnemonic = generateMnemonic();
    if (interactive) {
      ora().warn('Write down the 12 word-mnemonic below on a piece of paper and keep it in a safe place\n');
      await verifyMnemonic(mnemonic);
    }
    secrets.MASTER_KEY_MNEMONIC = mnemonic;
  } else if (!validateMnemonic(secrets.MASTER_KEY_MNEMONIC)) {
    ora().fail('MASTER_KEY_MNEMONIC in your secrets.env file is not valid');
    throw new Error('Invalid mnemonic');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airnode'));
  const tmpSecretsFile = path.join(tmpDir, 'secrets.json');
  fs.writeFileSync(tmpSecretsFile, JSON.stringify(secrets, null, 2));

  const airnodeId = deriveAirnodeId(secrets.MASTER_KEY_MNEMONIC);
  const masterWalletAddress = deriveMasterWalletAddress(secrets.MASTER_KEY_MNEMONIC);
  await checkAirnodeParameters(configs, secrets, airnodeId, masterWalletAddress);

  const airnodeIdShort = shortenAirnodeId(airnodeId);
  const receipts: Receipts = [];
  for (const config of configs) {
    try {
      await deployAirnode(
        airnodeIdShort,
        config.nodeSettings.stage,
        config.nodeSettings.cloudProvider,
        config.nodeSettings.region,
        configFile,
        tmpSecretsFile
      );
      receipts.push({
        airnodeId: deriveAirnodeId(secrets.MASTER_KEY_MNEMONIC),
        airnodeIdShort,
        config: { id: config.id, chains: config.chains, nodeSettings: config.nodeSettings },
        masterWalletAddress,
        xpub: deriveXpub(secrets.MASTER_KEY_MNEMONIC),
      });
    } catch {
      ora().warn(`Failed deploying configuration ${config.id}, skipping`);
    }
  }
  fs.writeFileSync(receiptFile, JSON.stringify(receipts, null, 2));
  ora().info(`Outputted ${receiptFile}\n` + '  This file does not contain any sensitive information.');
}

export async function remove(airnodeIdShort: string, stage: string, cloudProvider: string, region: string) {
  await removeAirnode(airnodeIdShort, stage, cloudProvider, region);
}

export async function removeWithReceipt(receiptFilename: string) {
  const receipts = parseReceiptFile(receiptFilename);
  for (const receipt of receipts) {
    try {
      await remove(
        receipt.airnodeIdShort,
        receipt.config.nodeSettings.stage,
        receipt.config.nodeSettings.cloudProvider,
        receipt.config.nodeSettings.region
      );
    } catch {
      ora().warn(`Failed removing configuration ${receipt.config.id}, skipping`);
    }
  }
}
