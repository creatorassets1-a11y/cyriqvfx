import { Link } from 'react-router-dom';
import { Mark } from '../../components/Logo';

/** Shared frame for the sign-in and sign-up flows. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="page flex min-h-[75vh] items-start justify-center py-16 md:py-24">
      <div className="w-full max-w-sm">
        <Link to="/" aria-label="Home" className="inline-block">
          <Mark size={40} />
        </Link>

        <h1 className="mt-6 text-[32px] leading-[1.08]">{title}</h1>
        {subtitle ? <p className="copy mt-3 text-[15px]">{subtitle}</p> : null}

        <div className="mt-8 border-t border-ink pt-7">{children}</div>

        {footer ? <div className="mt-6 text-[13.5px] text-soft">{footer}</div> : null}

        <p className="mt-8 border-t border-rule pt-5 text-[12.5px] text-faint">
          You never need an account to download.{' '}
          <Link to="/resources" className="link">
            Just browse
          </Link>
        </p>
      </div>
    </div>
  );
}
