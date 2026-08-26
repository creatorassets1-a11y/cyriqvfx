import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { Button, MoreLink, SelectField, TextArea, TextField, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

const REASONS = [
  { value: 'BROKEN_DOWNLOAD', label: 'The download does not work' },
  { value: 'BROKEN_RESOURCE', label: 'The file is broken or incomplete' },
  { value: 'INCORRECT_COMPATIBILITY', label: 'Compatibility info is wrong' },
  { value: 'LICENSING', label: 'Licensing problem' },
  { value: 'MALICIOUS_FILE', label: 'Suspicious or malicious file' },
  { value: 'COPYRIGHT', label: 'Copyright concern' },
  { value: 'OTHER', label: 'Something else' },
];

/** Reports (PRD §47). Open to guests, because a broken download blocks them too. */
export default function Report() {
  const [params] = useSearchParams();
  const { toast } = useToast();
  useTitle('Report a problem · Cyriq VFX');

  const [reason, setReason] = useState('BROKEN_DOWNLOAD');
  const [details, setDetails] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/reports', {
        resourceId: params.get('resource') || null,
        reason,
        details,
        contactEmail: email || undefined,
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err);
        toast(err.message, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="page py-20 md:py-28">
        <div className="max-w-lg">
          <p className="eyebrow flex items-center gap-2 text-go">
            <Icon name="check" size={14} />
            Sent
          </p>
          <h1 className="mt-3 text-[34px] leading-[1.05] md:text-[44px]">
            Thanks, that has been sent
          </h1>
          <p className="copy mt-5">
            The owner will see it in their reports inbox. If you left an email, you may hear back.
          </p>
          <MoreLink to="/resources">Back to resources</MoreLink>
        </div>
      </div>
    );
  }

  return (
    <div className="page py-12 md:py-20">
      <div className="max-w-lg">
        <p className="eyebrow">Something broken</p>
        <h1 className="mt-2 text-[34px] leading-[1.05] md:text-[44px]">Report a problem</h1>
        <p className="copy mt-4">
          A broken download or a wrong compatibility note is worth knowing about. This goes straight
          to the owner.
        </p>

        <form onSubmit={submit} className="mt-9 flex flex-col gap-7 border-t border-ink pt-8">
          <SelectField
            label="What is wrong?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectField>

          <TextArea
            label="What happened?"
            required
            rows={5}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Which resource, what you tried, and what happened instead."
            error={error?.fieldError('details')}
            hint="At least a sentence or two so it can actually be fixed."
          />

          <TextField
            label="Your email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            hint="Optional. Only used to reply about this report."
            error={error?.fieldError('contactEmail')}
          />

          <Button type="submit" variant="primary" size="lg" loading={busy} className="self-start">
            Send report
          </Button>
        </form>
      </div>
    </div>
  );
}
