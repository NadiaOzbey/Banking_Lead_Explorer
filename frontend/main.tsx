import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './style.css';
import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

type Actor = { email: string; role: 'admin' | 'client' };
type Profile = { id: string; name: string; region: string; sector: string; signal: string };
type Detail = Profile & { details: Record<string, string> };
const filterNames = ['region', 'sector', 'signal'] as const;
type Filters = Record<typeof filterNames[number], string[]>;
type ProfilePage = { items: Profile[]; total: number; unassignedCount: number; pageSize: number; filters: Filters };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function api<T>(path: string, options: { body?: FormData | Record<string, unknown>; signal?: AbortSignal } = {}): Promise<T> {
  const { body, signal } = options;
  const multipart = body instanceof FormData;
  const response = await fetch('/api' + path, {
    signal, method: body ? 'POST' : 'GET',
    headers: body ? { 'X-Lead-CSRF': '1', ...(!multipart && { 'Content-Type': 'application/json' }) } : undefined,
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    const rows = data.errors?.map((row: { line: number; reason: string }) => 'Line ' + row.line + ' — ' + row.reason);
    throw new ApiError(response.status, rows?.length ? [data.error + ' (' + data.errorCount + ' issues)', ...rows].join('\n') : data.error);
  }
  return data;
}

const message = (error: unknown) => error instanceof Error ? error.message : 'The request failed';
const title = (text: string) => text.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={`mt-3 whitespace-pre-wrap break-words rounded-md p-3 text-sm ${error ? 'bg-red-50 text-red-900' : 'bg-blue-50 text-blue-950'}`}>{children}</div>;
}

function Account({ onSignIn }: { onSignIn: (actor: Actor) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = { email: data.get('email'), password: data.get('password') };
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (register) {
        await api('/auth/register', { body });
        setRegister(false);
        setNotice('Your client account is ready. Sign in to redeem your access code.');
      } else {
        onSignIn(await api<Actor>('/auth/login', { body }));
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid items-start gap-10 py-12 md:grid-cols-[1.2fr_1fr] md:py-24">
    <section>
      <h1 className="max-w-xl text-4xl font-bold tracking-tight md:text-6xl">Explore your assigned leads</h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-700">Browse assigned company records and filter them by region, sector, and signal.</p>
    </section>
    <section className="panel">
      <h2 className="text-xl font-bold">{register ? 'Create a client account' : 'Sign in'}</h2>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <label>Email<input type="email" name="email" required autoComplete="email" maxLength={254} /></label>
        <label>Password<input key={String(register)} type="password" name="password" required minLength={12} autoComplete={register ? 'new-password' : 'current-password'} /></label>
        <button className="button w-full" disabled={busy}>{register ? 'Create account' : 'Sign in'}</button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <button type="button" disabled={busy} className="mt-4 text-sm font-semibold text-blue-800 hover:underline"
        onClick={() => { setRegister(!register); setError(''); setNotice(''); }}>
        {register ? 'Back to sign in' : 'Create a client account'}
      </button>
    </section>
  </div>;
}

function WorkspaceActions({ actor, refresh }: { actor: Actor; refresh: () => void }) {
  const [status, setStatus] = useState({ error: false, text: '' });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>, action: 'upload' | 'issue' | 'redeem') {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setStatus({ error: false, text: '' });
    try {
      if (action === 'upload') {
        const result = await api<{ imported: number }>('/admin/upload', { body: data });
        setStatus({ error: false, text: 'Imported ' + result.imported + ' profiles.' });
        refresh();
      } else if (action === 'issue') {
        const result = await api<{ code: string }>('/admin/access-codes', {
          body: { email: data.get('email'), profileIds: String(data.get('profileIds')).split(/[\s,]+/).filter(Boolean) },
        });
        setStatus({ error: false, text: 'Copy this single-use access code. It expires in seven days.\n' + result.code });
      } else {
        await api('/access-codes/redeem', { body: { code: data.get('code') } });
        setStatus({ error: false, text: 'Access code redeemed. Your assigned profiles are now available.' });
        refresh();
      }
      form.reset();
    } catch (error) {
      setStatus({ error: true, text: message(error) });
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel mt-6">
    <h2 className="mb-4 text-lg font-bold">{actor.role === 'admin' ? 'Administration' : 'Redeem an access code'}</h2>
    {actor.role === 'admin' ? <div className="grid gap-6 lg:grid-cols-2">
      <form className="space-y-3" onSubmit={(event) => void submit(event, 'upload')}>
        <label>Profile CSV<input type="file" name="file" accept=".csv,text/csv" required /></label>
        <button className="button" disabled={busy}>Upload CSV</button>
      </form>
      <form className="space-y-3" onSubmit={(event) => void submit(event, 'issue')}>
        <label>Client email<input type="email" name="email" required /></label>
        <label>Profile IDs<input name="profileIds" required placeholder="Separate IDs with commas" /></label>
        <button className="button" disabled={busy}>Create access code</button>
      </form>
    </div> : <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void submit(event, 'redeem')}>
      <label className="w-full max-w-md">Access code<input name="code" required autoComplete="off" /></label>
      <button className="button" disabled={busy}>Redeem code</button>
    </form>}
    {status.text && <Notice error={status.error}>{status.text}</Notice>}
  </section>;
}

function Explorer({ actor }: { actor: Actor }) {
  const [query, setQuery] = useState({ q: '', region: '', sector: '', signal: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ProfilePage>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ ...query, page: String(page) });
    const timer = setTimeout(() => {
      setError('');
      api<ProfilePage>('/profiles?' + params, { signal: abort.signal }).then(setResult)
        .catch((error) => { if (!abort.signal.aborted) setError(message(error)); });
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, page, revision]);

  return <>
    <h1 className="text-3xl font-bold tracking-tight">Lead Explorer</h1>
    <WorkspaceActions actor={actor} refresh={() => { setPage(1); setRevision((value) => value + 1); }} />
    <section aria-label="Profiles" className="panel mt-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>Search<input type="search" maxLength={200} value={query.q} placeholder="Company name or ID"
          onChange={(event) => { setQuery({ ...query, q: event.target.value }); setPage(1); }} /></label>
        {filterNames.map((name) => <div key={name}>
          <label htmlFor={name}>{title(name)}</label>
          <select id={name} value={query[name]} onChange={(event) => { setQuery({ ...query, [name]: event.target.value }); setPage(1); }}>
            <option value="">All</option>
            {result?.filters[name].map((value) => <option key={value} value={value}>{title(value)}</option>)}
          </select>
        </div>)}
      </div>
      {error ? <Notice error>{error}</Notice> : result ? <>
        <p className="muted my-5" aria-live="polite">{result.total} matching profiles{actor.role === 'client' && ' · ' + result.unassignedCount + ' unassigned profiles'}</p>
        {result.items.length ? <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700"><tr>{['Company', 'Region', 'Sector', 'Signal'].map((label) => <th scope="col" key={label} className="px-3 py-2.5">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-200">
              {result.items.map((profile) => <tr key={profile.id}>
                <td className="px-3 py-3"><a className="font-semibold" href={'/profiles/' + encodeURIComponent(profile.id)}>{profile.name}</a><p className="muted">{profile.id}</p></td>
                <td className="px-3 py-3">{profile.region}</td>
                <td className="px-3 py-3">{profile.sector}</td>
                <td className="px-3 py-3">{title(profile.signal)}</td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p className="muted">No profiles match your search.</p>}
        <div className="mt-5 flex items-center gap-3">
          <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page}</span>
          <button className="secondary" disabled={page * result.pageSize >= result.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </> : <p className="muted mt-4">Loading profiles…</p>}
    </section>
  </>;
}

function ProfileDetail({ id }: { id: string }) {
  const [profile, setProfile] = useState<Detail>();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    api<Detail>('/profiles/' + id, { signal: abort.signal }).then(setProfile)
      .catch((error) => { if (!abort.signal.aborted) setError(message(error)); });
    return () => abort.abort();
  }, [id]);

  return <>
    <a href="/">← Lead Explorer</a>
    {error ? <Notice error>{error}</Notice> : profile ? <section className="panel mt-5">
      <p className="muted">{profile.id}</p>
      <h1 className="mt-2 text-3xl font-bold">{profile.name}</h1>
      <dl className="mt-6 grid gap-5 sm:grid-cols-2">
        {Object.entries({ region: profile.region, sector: profile.sector, signal: title(profile.signal), ...profile.details })
          .filter(([, value]) => value !== '').map(([field, value]) => <div key={field}>
            <dt className="muted">{title(field)}</dt><dd className="mt-1 break-words">{value}</dd>
          </div>)}
      </dl>
    </section> : <p className="muted mt-4">Loading profile…</p>}
  </>;
}

function App() {
  const [actor, setActor] = useState<Actor | null>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Actor>('/auth/me').then(setActor).catch((error) => {
      if (!(error instanceof ApiError && error.status === 401)) setError(message(error));
      setActor(null);
    });
  }, []);

  async function signOut() {
    try {
      await api('/auth/logout', { body: {} });
      window.location.assign('/');
    } catch (error) {
      setError(message(error));
    }
  }

  const profile = /^\/profiles\/([^/]+)$/.exec(window.location.pathname);
  return <>
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4">
        <a href="/" className="text-xl font-bold tracking-tight text-slate-950">Lead Explorer</a>
        {actor && <div className="flex items-center gap-3">
          <span className="muted hidden sm:inline">{actor.email}</span>
          <button className="secondary" onClick={() => void signOut()}>Sign out</button>
        </div>}
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-8">
      {error && <Notice error>{error}</Notice>}
      {actor === undefined ? <p className="muted">Loading workspace…</p> : actor
        ? profile ? <ProfileDetail id={profile[1]} /> : <Explorer actor={actor} />
        : <Account onSignIn={(actor) => { setError(''); setActor(actor); }} />}
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
