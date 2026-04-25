'use client';
import styles from './ConfirmReplaceProgModal.module.css';

interface Props {
  isOpen: boolean;
  pendingCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmReplaceProgModal({
  isOpen, pendingCount, onConfirm, onCancel,
}: Props): React.ReactElement | null {
  if (!isOpen) return null;
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h3 className={styles.title}>Remplacer la programmation</h3>
        <p className={styles.body}>
          Vous avez <strong>{pendingCount}</strong> ordre{pendingCount > 1 ? 's' : ''} en attente.
          Appliquer la route va remplacer tous les ordres futurs et activer la voile automatique.
        </p>
        <p className={styles.body}>Les ordres d&eacute;j&agrave; d&eacute;clench&eacute;s sont conserv&eacute;s.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>Annuler</button>
          <button type="button" className={styles.confirm} onClick={onConfirm}>Remplacer</button>
        </div>
      </div>
    </div>
  );
}
