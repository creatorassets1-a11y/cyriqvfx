import { Link } from 'react-router-dom';
import { LinkButton } from '../components/ui';
import { useTitle } from '../lib/hooks';

/** Branded not-found with real ways out (PRD §52). */
export default function NotFound() {
  useTitle('Not found · Cyriq VFX');

  return (
    <div className="page py-20 md:py-32">
      <div className="max-w-xl">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 text-[44px] leading-[1.02] md:text-[64px]">This one got cut</h1>
        <p className="copy mt-5 text-[17px]">
          That page does not exist, or it was moved. The library is still here, though.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3">
          <LinkButton to="/resources" variant="primary" size="lg" iconRight="arrow-right">
            Browse resources
          </LinkButton>
          <Link to="/" className="link text-[15px] font-medium">
            Go home
          </Link>
        </div>

        <p className="mt-10 border-t border-rule pt-5 text-[13px] text-faint">
          Looking for something specific? Try the search in the header.
        </p>
      </div>
    </div>
  );
}
