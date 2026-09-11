import type { Address } from 'viem';
import { CONTRACTS } from './config';
import { getTicketHolder } from './chain-reads';
import { walletRequest } from './wallet-request';
import { walletActionMessage } from './wallet-errors';

export async function requestTicketImports(account: Address, tokenIds: string[]) {
  const provider = window.ethereum;
  if (!provider) return 'Tickets are issued. Open MetaMask to import them using the details below.';
  let requested = 0;
  for (const tokenId of tokenIds) {
    try {
      const accounts = await walletRequest(provider, 'eth_accounts');
      const chain = await walletRequest(provider, 'eth_chainId');
      if (Number(chain) !== 5042002 || !Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== account.toLowerCase()) return 'Tickets are issued. Switch back to the claiming wallet on Arc Testnet, then retry Add to wallet.';
      if ((await getTicketHolder(BigInt(tokenId))).toLowerCase() !== account.toLowerCase()) continue;
      const accepted = await walletRequest(provider, 'wallet_watchAsset', 30000, { type: 'ERC721', options: { address: CONTRACTS.ticketNFT, tokenId } });
      if (accepted !== true) return 'Tickets are issued. Wallet import was not confirmed; you can retry Add to wallet.';
      requested++;
    } catch (error) {
      return `Tickets are issued; wallet display could not finish. ${walletActionMessage(error)} You can retry Add to wallet or import manually below.`;
    }
  }
  return requested ? `MetaMask accepted ${requested} NFT import request${requested === 1 ? '' : 's'}. Check its NFTs tab and complete any confirmation.` : 'These claimed tickets are no longer held directly by this wallet. They may be deposited or transferred; check their current positions.';
}
