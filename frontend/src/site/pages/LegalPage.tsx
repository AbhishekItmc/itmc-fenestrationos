import { Link } from 'react-router-dom';
import { siteConfig } from '../siteConfig';
import { useDocumentMeta } from '../useDocumentMeta';
import { Container, Eyebrow } from '../ui';

const TITLES = { privacy: 'Privacy policy', terms: 'Terms of use' } as const;

export default function LegalPage({ kind }: { kind: keyof typeof TITLES }) {
  const title = TITLES[kind];
  useDocumentMeta(title, `${title} for ${siteConfig.productName}.`);
  return (
    <Container className="max-w-[760px] py-16 sm:py-24">
      <Eyebrow>Legal</Eyebrow>
      <h1 className="mt-5 text-4xl font-semibold">{title}</h1>
      <p className="mt-6 text-lg leading-[1.6] text-muted" data-testid="legal-placeholder">
        The {title.toLowerCase()} is to be provided by ITMC.
      </p>
      <p className="mt-4 text-[15px] leading-[1.6] text-muted">
        Questions in the meantime:{' '}
        <a href={`mailto:${siteConfig.contactEmail}`} className="site-link text-fg">
          {siteConfig.contactEmail}
        </a>
        .
      </p>
      <Link to="/" className="site-btn site-btn-secondary mt-10">
        Back to home
      </Link>
    </Container>
  );
}
