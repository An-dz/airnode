import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config as nodeConfig } from '@api3/node';
import { checkAirnodeParameters } from '../evm';
import { deployAirnode, removeAirnode } from '../infrastructure';
import {
  deriveAirnodeId,
  deriveMasterWalletAddress,
  writeReceiptFile,
  parseReceiptFile,
  parseSecretsFile,
  shortenAirnodeId,
  validateConfig,
  validateMnemonic,
} from '../utils';
import * as logger from '../utils/logger';

export async function deploy(configFile: string, secretsFile: string, receiptFile: string, nodeVersion: string) {
  const secrets = parseSecretsFile(secretsFile);
  const config = nodeConfig.parseConfig(configFile, secrets);
  validateConfig(config, nodeVersion);

  const mnemonic = config.nodeSettings.airnodeWalletMnemonic;
  if (!validateMnemonic(mnemonic)) {
    logger.fail('AIRNODE_WALLET_MNEMONIC in your secrets.env file is not valid');
    throw new Error('Invalid mnemonic');
  }

  const httpGateway = config.nodeSettings.httpGateway;
  let httpGatewayApiKey: string | undefined = undefined;
  if (httpGateway.enabled) {
    httpGatewayApiKey = httpGateway.apiKey;
    if (!httpGatewayApiKey) {
      throw new Error('Unable to deploy HTTP gateway as the API key is missing');
    }
  }

  logger.debug('Creating a temporary secrets.json file');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airnode'));
  const tmpSecretsFile = path.join(tmpDir, 'secrets.json');
  fs.writeFileSync(tmpSecretsFile, JSON.stringify(secrets, null, 2));

  const airnodeId = deriveAirnodeId(mnemonic);
  const masterWalletAddress = deriveMasterWalletAddress(mnemonic);
  await checkAirnodeParameters(config, airnodeId, masterWalletAddress);

  let output = {};
  try {
    output = await deployAirnode(
      shortenAirnodeId(airnodeId),
      config.nodeSettings.stage,
      config.nodeSettings.cloudProvider,
      config.nodeSettings.region,
      httpGatewayApiKey,
      configFile,
      tmpSecretsFile
    );
  } catch (err) {
    logger.warn(`Failed deploying configuration, skipping`);
    logger.warn(err.toString());
  }

  logger.debug('Deleting a temporary secrets.json file');
  fs.rmSync(tmpDir, { recursive: true });

  writeReceiptFile(receiptFile, mnemonic, config, output);
}

export async function remove(airnodeIdShort: string, stage: string, cloudProvider: string, region: string) {
  await removeAirnode(airnodeIdShort, stage, cloudProvider, region);
}

export async function removeWithReceipt(receiptFilename: string) {
  const receipt = parseReceiptFile(receiptFilename);
  const { airnodeIdShort, cloudProvider, region, stage } = receipt.deployment;
  try {
    await remove(airnodeIdShort, stage, cloudProvider, region);
  } catch (err) {
    logger.warn(`Failed removing configuration, skipping`);
    logger.warn(err.toString());
  }
}
