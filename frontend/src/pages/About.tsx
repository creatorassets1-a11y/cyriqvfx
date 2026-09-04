import { Link } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { HomePayload } from '../lib/types';
import { formatCount } from '../lib/format';
import { Brand } from '../components/Brand';
import { ButtonLink } from '../ui/primitives';

/**
 * About.
 *
 * The owner writes this page in the CMS, so everything here except the shape
 * of it comes from the database. The numbers underneath are the real ones the
 * catalogue reports, not a claim typed into a settings field.
 */
export default function About() {
  const { settings } = useSession();
  const { data } = useLoad<HomePayload>('/resources/home');

  return (
    <div className="page py-12 md:py-20">
      <div className="max-w-2xl">
        <Brand name={settings?.siteName ?? 'Cyriq VFX'} as="plain" size={40} />

        <h1 className="mt-6 text-[34px] md:text-[46px]">
          {settings?.aboutTitle ?? 'About this library'}
        </h1>

        <div className="prose mt-6 whitespace-pre-line text-[17px]">
          {settings?.aboutBody ??
            'A personal library of free editing resources, published by one editor for other editors.'}
        </div>

        {data ? (
          <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-5 border-y border-line py-6">
            <div>
              <dt className="kicker">Resources published</dt>
              <dd className="mt-1 font-mono text-[24px]">{formatCount(data.stats.resourceCount)}</dd>
            </div>
            <div>
              <dt className="kicker">Downloads served</dt>
              <dd className="mt-1 font-mono text-[24px]">{formatCount(data.stats.downloadCount)}</dd>
            </div>
            <div>
              <dt className="kicker">Cost to you</dt>
              <dd className="mt-1 font-mono text-[24px]">Nothing</dd>
            </div>
          </dl>
        ) : null}

        <section className="mt-12">
          <h2 className="text-[24px]">How the licensing works</h2>
          <p className="prose mt-3">
            Every resource carries its own license, shown on its page before you download it. Most
            are free for commercial work; a few ask for credit. Nothing here needs an account, a
            subscription or an email address.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-[24px]">Get in touch</h2>
          <p className="prose mt-3">
            Missing something you need?{' '}
            <Link to="/requests" className="underlined">
              Request a resource
            </Link>
            . Found a file that is broken or mislabelled?{' '}
            <Link to="/report" className="underlined">
              Report it
            </Link>
            {settings?.contactEmail ? (
              <>
                , or email{' '}
                <a href={`mailto:${settings.contactEmail}`} className="underlined">
                  {settings.contactEmail}
                </a>
              </>
            ) : null}
            .
          </p>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <ButtonLink to="/resources" variant="primary" size="lg">
            Browse the library
          </ButtonLink>
          <ButtonLink to="/tutorials" size="lg">
            Watch a tutorial
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
