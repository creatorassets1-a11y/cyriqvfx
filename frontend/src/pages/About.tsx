import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFetch, useTitle } from '../lib/hooks';
import { LinkButton, Skeleton } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatCount } from '../lib/format';

export default function About() {
  const { settings } = useAuth();
  useTitle('About · Cyriq VFX');

  const { data } = useFetch<{ stats: { resourceCount: number; downloadCount: number } }>(
    '/resources/home',
  );

  if (!settings) {
    return (
      <div className="page py-16">
        <Skeleton className="mb-5 h-12 w-64" />
        <Skeleton className="h-40 w-full max-w-2xl" />
      </div>
    );
  }

  const social = Object.entries(settings.social).filter(([, href]) => href) as Array<[string, string]>;

  return (
    <div className="page py-10 md:py-16">
      <div className="max-w-3xl border-b border-ink pb-6">
        <p className="eyebrow">About</p>
        <h1 className="mt-3 text-[40px] leading-[1.04] md:text-[56px]">{settings.aboutTitle}</h1>
        <p className="copy mt-6 text-[17px]">{settings.aboutBody}</p>
      </div>

      <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-3">
        <Principle
          icon="download"
          title="No signup to download"
          body="Every file downloads without an account. An account only adds history, saved items and update alerts."
        />
        <Principle
          icon="shield"
          title="Licenses in plain language"
          body="Each resource states exactly what you can do with it: personal use, commercial use, modification, credit."
        />
        <Principle
          icon="check"
          title="Honest compatibility"
          body="Version ranges come from actual testing. If something is untested, it says so rather than guessing."
        />
      </div>

      {data && data.stats.resourceCount > 0 ? (
        <div className="mt-14 flex flex-wrap gap-x-16 gap-y-6 border-y border-rule py-8">
          <Stat label="Resources" value={String(data.stats.resourceCount)} />
          {data.stats.downloadCount > 0 ? (
            <Stat label="Downloads" value={formatCount(data.stats.downloadCount)} />
          ) : null}
        </div>
      ) : null}

      <section className="mt-14 max-w-2xl">
        <h2 className="border-b border-rule pb-3 text-[24px] md:text-[28px]">A note on the files</h2>
        <p className="copy mt-4">
          Scripts, extensions and project files are ordinary files that your editing software runs.
          Read the included README before installing anything, and only install tools from sources
          you trust, including this one. Nothing here is executed on the server; files are stored
          and served exactly as uploaded.
        </p>
      </section>

      <section className="mt-14 max-w-2xl">
        <h2 className="border-b border-rule pb-3 text-[24px] md:text-[28px]">Get in touch</h2>
        <p className="copy mt-4">
          Found something broken, or want a resource that does not exist yet? Both are useful to
          know about.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <LinkButton to="/requests" variant="primary" iconRight="arrow-right">
            Request a resource
          </LinkButton>
          <Link to="/report" className="link text-[14.5px]">
            Report a problem
          </Link>
          {settings.contactEmail ? (
            <a href={`mailto:${settings.contactEmail}`} className="link text-[14.5px]">
              Email
            </a>
          ) : null}
        </div>

        {social.length > 0 ? (
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule pt-5">
            {social.map(([name, href]) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer me"
                className="link text-[13.5px] capitalize"
              >
                {name}
              </a>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Principle({
  icon,
  title,
  body,
}: {
  icon: 'download' | 'shield' | 'check';
  title: string;
  body: string;
}) {
  return (
    <div className="min-w-0 border-t border-rule pt-5">
      <Icon name={icon} size={18} className="text-blue" />
      <h2 className="mt-3 font-display text-[19px] leading-snug">{title}</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-soft">{body}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-display text-[40px] leading-none">{value}</p>
      <p className="eyebrow mt-2.5">{label}</p>
    </div>
  );
}
