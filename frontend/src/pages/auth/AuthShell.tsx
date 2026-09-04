import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Brand } from '../../components/Brand';

/**
 * The frame every sign-in screen shares. It keeps the way out visible: the
 * library is one click away, because nothing here is required to use the site.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { settings } = useSession();

  return (
    <div className="page flex min-h-[80vh] items-center justify-center py-14">
      <div className="w-full max-w-sm">
        <Brand name={settings?.siteName ?? 'Cyriq VFX'} className="mb-9" />

        <h1 className="text-[30px] leading-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-2 text-[14px] leading-relaxed text-text-3">{subtitle}</p>
        ) : null}

        <div className="mt-8">{children}</div>

        {footer ? <div className="mt-7 text-[13.5px] text-text-3">{footer}</div> : null}

        <p className="mt-10 border-t border-line pt-5 text-[12.5px] text-text-4">
          Downloading never needs an account.{' '}
          <Link to="/resources" className="underlined">
            Go straight to the library
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
