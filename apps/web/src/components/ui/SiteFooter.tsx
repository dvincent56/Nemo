import styles from './SiteFooter.module.css';

export function SiteFooter(): React.ReactElement {
  return (
    <footer className={styles.foot}>
      <div className={styles.seal}>Nemo · Saison 2026</div>
      <nav className={styles.links} aria-label="Liens bas de page">
        <a href="#">Aide</a>
        <a href="#">Contact</a>
        <a href="#">Statut système</a>
        <a href="#">Mentions légales</a>
      </nav>
    </footer>
  );
}
