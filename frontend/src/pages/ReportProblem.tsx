import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useLoad } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Resource } from '../lib/types';
import { Button, ButtonLink, Field, Input, Note, Select, Textarea } from '../ui/primitives';
import { Icon } from '../ui/Icon';

/**
 * Reporting a problem.
 *
 * A broken file is the worst thing this site can do to someone, so reporting
 * one takes no account, no login and one screen. The resource is filled in
 * automatically when the report starts from a resource page.
 */

const REASONS = [
  { value: 'BROKEN_DOWNLOAD', label: 'The download does not work' },
  { value: 'BROKEN_RESOURCE', label: 'The file is broken or unusable' },
  { value: 'INCORRECT_COMPATIBILITY', label: 'It does not work with the software listed' },
  { value: 'LICENSING', label: 'The license is unclear or wrong' },
  { value: 'MALICIOUS_FILE', label: 'The file looks malicious' },
  { value: 'COPYRIGHT', label: 'It infringes a copyright' },
  { value: 'OTHER', label: 'Something else' },
];

export default function ReportProblem() {
  const [params] = useSearchParams();
  const { user } = useSession();
  const slug = params.get('resource');

  const resource = useLoad<Resource>(slug ? `/resources/${slug}` : null);

  const [reason, setReason] = useState(REASONS[0].value);
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setFailure(null);

    try {
      await api.post('/reports', {
        resourceId: resource.data?.id ?? null,
        reason,
        details,
        contactEmail: email,
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) setFailure(err);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="page flex min-h-[60vh] flex-col items-center justify-center text-center">
        <Icon name="check" size={26} className="text-positive" />
        <h1 className="mt-4 text-[30px]">Thanks — that has been sent</h1>
        <p className="prose mt-3 text-center">
          The owner sees every report. If you left an email address, you will hear back when it is
          sorted.
        </p>
        <div className="mt-8 flex gap-3">
          <ButtonLink to="/resources" variant="primary">
            Back to the library
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="page py-12 md:py-16">
      <div className="max-w-xl">
        <h1 className="text-[32px] md:text-[40px]">Report a problem</h1>
        <p className="prose mt-3">
          Something broken, mislabelled or wrong? Tell the owner. No account needed.
        </p>

        {resource.data ? (
          <p className="mt-5 border-l-2 border-accent py-1 pl-4 text-[13.5px] text-text-2">
            About{' '}
            <Link to={`/resources/${resource.data.slug}`} className="underlined">
              {resource.data.title}
            </Link>
          </p>
        ) : null}

        <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
          <Field label="What is wrong?" error={failure?.on('reason')}>
            {(props) => (
              <Select {...props} value={reason} onChange={(event) => setReason(event.target.value)}>
                {REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="What happened?"
            hint="What you did, what you expected, and what happened instead."
            error={failure?.on('details')}
          >
            {(props) => (
              <Textarea
                {...props}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={6}
                required
              />
            )}
          </Field>

          <Field
            label="Your email"
            optional
            hint="Only used to reply about this report."
            error={failure?.on('contactEmail')}
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email || (user?.email ?? '')}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>

          {failure && failure.issues.length === 0 ? (
            <Note tone="critical">{failure.message}</Note>
          ) : null}

          <div>
            <Button type="submit" variant="primary" size="lg" loading={sending}>
              Send the report
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
