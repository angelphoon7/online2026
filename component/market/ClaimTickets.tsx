"use client";

import { useRef, useState } from 'react';
import type { Address } from 'viem';
import type { ChainReceipt } from '@/lib/market-types';
import type { useWallet } from '@/lib/hooks/useWallet';
import { CONTRACTS } from '@/lib/config';
import { EXPLORER } from '@/lib/ui-copy';
import { truncateAddress } from '@/lib/format';
import { requestTicketImports } from '@/lib/wallet-nfts';
import { walletActionMessage } from '@/lib/wallet-errors';
import { walletChangesTickets } from '@/lib/personal-swap';
import styles from './ClaimTickets.module.css';

const equal = (a: string, b: string | null) => a.toLowerCase() === b?.toLowerCase();
const receivedBy = (receipt: ChainReceipt, address: Address) => [...new Set(receipt.participants
  .filter(participant => equal(participant.owner, address)).flatMap(participant => participant.receives))];

export default function ClaimTickets({ receipt, wallet, disabled }: {
  receipt: ChainReceipt;
  wallet: Pick<ReturnType<typeof useWallet>, 'account' | 'runWithWallet' | 'isConnecting'>;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ owner: Address | null; message: string } | null>(null);
  const inFlight = useRef(false);
  const { account, runWithWallet } = wallet;
  const ids = account ? receivedBy(receipt, account) : [];
  const isSeller = receipt.participants.some(participant => equal(participant.owner, account)) && !ids.length;
  if (receipt.status !== 'success' || !receipt.participants.some(participant => participant.receives.length)) return null;
  // A proposer can pay for somebody else's settlement. That receipt offers them no claim.
  if (account && !receipt.participants.some(participant => equal(participant.owner, account))) return null;
  if (account && !walletChangesTickets(receipt.participants, account)) return null;

  const claim = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setFeedback(null);
    let receivingAccount = account;
    try {
      await runWithWallet(async address => {
        receivingAccount = address;
        const tickets = receivedBy(receipt, address);
        if (!tickets.length) throw new Error('This wallet did not receive tickets in this swap. Switch to a receiving wallet, then claim again.');
        const message = await requestTicketImports(address, tickets, 'Claim my tickets');
        setFeedback({ owner: address, message });
      });
    } catch (error) {
      setFeedback({ owner: receivingAccount, message: walletActionMessage(error) });
    } finally { inFlight.current = false; setPending(false); }
  };

  return <section className={`${styles.claim} swap-nft-import`} aria-label="Claim your tickets">
    <div className={styles.main}>
      <div>
        <h3>{isSeller ? 'Your sale is complete' : 'Claim your tickets'}</h3>
        <p>{isSeller ? 'You received no tickets in this swap.' : ids.length
          ? 'Your tickets were delivered during the swap. Add them to your wallet’s NFTs tab.'
          : 'Connect the wallet that received tickets in this swap to add them to its NFTs tab.'}</p>
        {ids.length > 0 && <p className={styles.tokens}>{ids.map(id => `#${id}`).join(' · ')}</p>}
      </div>
      {!isSeller && <button type="button" className="primary" disabled={disabled || pending || wallet.isConnecting}
        onClick={() => void claim()}>{pending ? 'Open your wallet…' : 'Claim my tickets'}<span aria-hidden="true">↗</span></button>}
    </div>
    {feedback && (feedback.owner === null ? account === null : equal(feedback.owner, account)) && <p role="status">{feedback.message}</p>}
    {!isSeller && <details className={styles.details}>
      <summary>Tickets not showing?</summary>
      <p>In your wallet, select Arc Testnet → NFTs → Import NFT. Use this contract and each token ID below.</p>
      <a className={styles.contract} href={`${EXPLORER}/address/${CONTRACTS.ticketNFT}`} target="_blank" rel="noreferrer">{CONTRACTS.ticketNFT}</a>
      {ids.length ? <p>Token IDs: {ids.join(', ')}</p> : <ul>{[...new Set(receipt.participants.filter(p => p.receives.length).map(p => p.owner.toLowerCase()))].map(owner =>
        <li key={owner}><a href={`${EXPLORER}/address/${owner}`} title={owner} target="_blank" rel="noreferrer">{truncateAddress(owner)}</a> · Token IDs: {receivedBy(receipt, owner as Address).join(', ')}</li>)}</ul>}
      <p>These tickets have no artwork yet, so your wallet may show a placeholder.</p>
    </details>}
  </section>;
}
