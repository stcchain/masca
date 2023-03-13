import { didCoinTypeMappping } from '@blockchain-lab-um/ssi-snap-types';
import {
  BIP44CoinTypeNode,
  getBIP44AddressKeyDeriver,
} from '@metamask/key-tree';
import { SnapsGlobalObject } from '@metamask/snaps-types';
import { ethers } from 'ethers';
import { ApiParams, SSISnapState } from 'src/interfaces';

import { updateSnapState } from './stateUtils';

export function getAccountIndex(
  state: SSISnapState,
  account: string
): number | undefined {
  if (state.accountState[account].index)
    return state.accountState[account].index;
  return undefined;
}

export async function setAccountIndex(
  snap: SnapsGlobalObject,
  state: SSISnapState,
  account: string,
  index: number
) {
  // eslint-disable-next-line no-param-reassign
  state.accountState[account].index = index;
  await updateSnapState(snap, state);
}

export async function getAddressKeyDeriver(
  params: ApiParams,
  coin_type?: number
) {
  const { state, snap, account } = params;
  let ct = coin_type;
  if (ct === undefined) {
    const method = state.accountState[account].accountConfig.ssi.didMethod;
    ct = didCoinTypeMappping[method];
  }
  const bip44CoinTypeNode = (await snap.request({
    method: 'snap_getBip44Entropy',
    params: {
      coinType: ct,
    },
  })) as BIP44CoinTypeNode;
  return bip44CoinTypeNode;
}

export async function getAddressKey(
  bip44CoinTypeNode: BIP44CoinTypeNode,
  addressIndex = 0
) {
  const keyDeriver = await getBIP44AddressKeyDeriver(bip44CoinTypeNode);
  const derivedKey = await keyDeriver(addressIndex);
  const { privateKey } = derivedKey;
  const { chainCode } = derivedKey;
  const addressKey = `${privateKey as string}${chainCode.split('0x')[1]}`;
  if (privateKey === undefined) return null;
  return {
    privateKey,
    originalAddressKey: addressKey,
    derivationPath: keyDeriver.path,
  };
}

export const getKeysFromAddressIndex = async (
  bip44CoinTypeNode: BIP44CoinTypeNode,
  addressIndex: number | undefined
) => {
  if (addressIndex === undefined) {
    throw new Error('addressIndex undefined');
  }

  const result = await getAddressKey(bip44CoinTypeNode, addressIndex);
  if (result === null) return null;
  const { privateKey, derivationPath } = result;
  const snap = new ethers.Wallet(privateKey);

  return {
    privateKey,
    publicKey: snap.publicKey,
    address: snap.address,
    addressIndex,
    derivationPath,
  };
};

export const getKeysFromAddress = async (
  bip44CoinTypeNode: BIP44CoinTypeNode,
  account: string,
  maxScan = 20,
  addressIndex?: number
): Promise<KeysType | null> => {
  if (addressIndex !== undefined)
    return getKeysFromAddressIndex(bip44CoinTypeNode, addressIndex);

  for (let i = 0; i < maxScan; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const keys = await getKeysFromAddressIndex(bip44CoinTypeNode, i);
    if (keys && keys.address.toUpperCase() === account.toUpperCase())
      return keys;
  }

  return null;
};

export const snapGetKeysFromAddress = async (
  bip44CoinTypeNode: BIP44CoinTypeNode,
  state: SSISnapState,
  account: string,
  snap: SnapsGlobalObject,
  maxScan = 20
): Promise<KeysType | null> => {
  const addressIndex = getAccountIndex(state, account);
  if (addressIndex) {
    return getKeysFromAddress(
      bip44CoinTypeNode,
      account,
      maxScan,
      addressIndex
    );
  }
  const res = await getKeysFromAddress(bip44CoinTypeNode, account, maxScan);
  if (res) {
    await setAccountIndex(snap, state, account, res.addressIndex);
    return res;
  }

  return null;
};

type KeysType = {
  privateKey: string;
  publicKey: string;
  address: string;
  addressIndex: number;
  derivationPath: string;
};
