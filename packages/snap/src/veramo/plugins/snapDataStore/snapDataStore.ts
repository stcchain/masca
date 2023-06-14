/* eslint-disable max-classes-per-file */
import { uint8ArrayToHex } from '@blockchain-lab-um/utils';
import {
  AbstractDataStore,
  type IFilterArgs,
  type IQueryResult,
} from '@blockchain-lab-um/veramo-datamanager';
import { MetaMaskInpageProvider } from '@metamask/providers';
import type { SnapsGlobalObject } from '@metamask/snaps-types';
import type {
  IIdentifier,
  RequireOnly,
  W3CVerifiableCredential,
} from '@veramo/core';
import { AbstractDIDStore } from '@veramo/did-manager';
import type { ManagedPrivateKey } from '@veramo/key-manager';
import { sha256 } from 'ethereum-cryptography/sha256';
import jsonpath from 'jsonpath';

import { decodeJWT } from '../../../utils/jwt';
import { getCurrentAccount } from '../../../utils/snapUtils';
import { getSnapState, updateSnapState } from '../../../utils/stateUtils';

export type ImportablePrivateKey = RequireOnly<
  ManagedPrivateKey,
  'privateKeyHex' | 'type'
>;

/**
 * An implementation of {@link AbstractDIDStore} that holds everything in snap state.
 *
 * This is usable by {@link @veramo/did-manager} to hold the did key data.
 */
export class SnapDIDStore extends AbstractDIDStore {
  snap: SnapsGlobalObject;

  ethereum: MetaMaskInpageProvider;

  constructor(
    snapParam: SnapsGlobalObject,
    ethereumParam: MetaMaskInpageProvider
  ) {
    super();
    this.snap = snapParam;
    this.ethereum = ethereumParam;
  }

  async getDID({
    did,
    alias,
    provider,
  }: {
    did: string;
    alias: string;
    provider: string;
  }): Promise<IIdentifier> {
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);
    const { identifiers } = state.accountState[account];

    if (did && !alias) {
      if (!identifiers[did])
        throw Error(`not_found: IIdentifier not found with did=${did}`);
      return identifiers[did];
    }
    if (!did && alias && provider) {
      for (const key of Object.keys(identifiers)) {
        if (
          identifiers[key].alias === alias &&
          identifiers[key].provider === provider
        ) {
          return identifiers[key];
        }
      }
    } else {
      throw Error('invalid_argument: Get requires did or (alias and provider)');
    }
    throw Error(
      `not_found: IIdentifier not found with alias=${alias} provider=${provider}`
    );
  }

  async deleteDID({ did }: { did: string }) {
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);

    if (!state.accountState[account].identifiers[did]) {
      throw Error('Identifier not found');
    }

    delete state.accountState[account].identifiers[did];
    await updateSnapState(this.snap, state);
    return true;
  }

  async importDID(args: IIdentifier) {
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);
    const identifier = { ...args };
    for (const key of identifier.keys) {
      if ('privateKeyHex' in key) {
        delete key.privateKeyHex;
      }
    }
    state.accountState[account].identifiers[args.did] = identifier;
    await updateSnapState(this.snap, state);
    return true;
  }

  async listDIDs(args: {
    alias?: string;
    provider?: string;
  }): Promise<IIdentifier[]> {
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);

    let result: IIdentifier[] = [];
    for (const key of Object.keys(state.accountState[account].identifiers)) {
      result.push(state.accountState[account].identifiers[key]);
    }

    if (args.alias && !args.provider) {
      result = result.filter((i) => i.alias === args.alias);
    } else if (args.provider && !args.alias) {
      result = result.filter((i) => i.provider === args.provider);
    } else if (args.provider && args.alias) {
      result = result.filter(
        (i) => i.provider === args.provider && i.alias === args.alias
      );
    }

    return result;
  }
}

/**
 * An implementation of {@link AbstractDataStore} that holds everything in snap state.
 */
export class SnapVCStore extends AbstractDataStore {
  snap: SnapsGlobalObject;

  ethereum: MetaMaskInpageProvider;

  constructor(
    snapParam: SnapsGlobalObject,
    ethereumParam: MetaMaskInpageProvider
  ) {
    super();
    this.snap = snapParam;
    this.ethereum = ethereumParam;
  }

  async query(args: IFilterArgs): Promise<Array<IQueryResult>> {
    const { filter } = args;
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);

    if (filter && filter.type === 'id') {
      try {
        if (state.accountState[account].vcs[filter.filter as string]) {
          let vc = state.accountState[account].vcs[
            filter.filter as string
          ] as unknown;
          if (typeof vc === 'string') {
            vc = decodeJWT(vc);
          }
          const obj = [
            {
              metadata: { id: filter.filter as string },
              data: vc,
            },
          ];
          return obj;
        }
        return [];
      } catch (e) {
        throw new Error('Invalid id');
      }
    }
    if (filter === undefined || (filter && filter.type === 'none')) {
      return Object.keys(state.accountState[account].vcs).map((k) => {
        let vc = state.accountState[account].vcs[k] as unknown;
        if (typeof vc === 'string') {
          vc = decodeJWT(vc);
        }
        return {
          metadata: { id: k },
          data: vc,
        };
      });
    }
    if (filter && filter.type === 'JSONPath') {
      const objects = Object.keys(state.accountState[account].vcs).map((k) => {
        let vc = state.accountState[account].vcs[k] as unknown;
        if (typeof vc === 'string') {
          vc = decodeJWT(vc);
        }
        return {
          metadata: { id: k },
          data: vc,
        };
      });
      const filteredObjects = jsonpath.query(objects, filter.filter as string);
      return filteredObjects as Array<IQueryResult>;
    }
    return [];
  }

  async delete({ id }: { id: string }) {
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);

    if (!state.accountState[account].vcs[id]) throw Error('ID not found');

    delete state.accountState[account].vcs[id];
    await updateSnapState(this.snap, state);
    return true;
  }

  async save(args: { data: W3CVerifiableCredential }): Promise<string> {
    const vc = args.data;
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);

    const id = uint8ArrayToHex(sha256(Buffer.from(JSON.stringify(vc))));

    if (!state.accountState[account].vcs[id]) {
      state.accountState[account].vcs[id] = vc;
      await updateSnapState(this.snap, state);
    }

    return id;
  }

  public async clear(_args: IFilterArgs): Promise<boolean> {
    // TODO implement filter (in ceramic aswell)
    const state = await getSnapState(this.snap);
    const account = getCurrentAccount(state);

    state.accountState[account].vcs = {};
    return true;
  }
}
