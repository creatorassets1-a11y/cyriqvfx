import { Link } from 'react-router-dom';
import { useTitle } from '../lib/hooks';
import { ButtonLink } from '../ui/primitives';

/**
 * The 404. The server already returned the right status for this URL; what is
 * left is to say so in the site's own voice and hand back the two routes that
 * actually recover the visit.
 */
export default function NotFound() {
  useTitle('Not found · Cyriq VFX');

  return (
    <div className="page flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="kicker">404</p>
      <h1 className="mt-3 text-[34px] md:text-[44px]">This one got cut</h1>
      <p className="prose mt-4 text-center">
        That page is not here. It may have been renamed, or the link may have lost a character on
        its way to you.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <ButtonLink to="/resources" variant="primary" size="lg">
          Browse resources
        </ButtonLink>
        <ButtonLink to="/" size="lg">
          Go to the front page
        </ButtonLink>
      </div>

      <p className="mt-8 text-[13px] text-text-3">
        Looking for something specific?{' '}
        <Link to="/requests" className="underlined">
          Ask for it
        </Link>
        .
      </p>
    </div>
  );
}
