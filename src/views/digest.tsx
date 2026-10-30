import type { NightDigest } from '../digest/types.js';

export function DigestPage({ night, digest }: { night: string; digest: NightDigest }) {
  return (
    <>
      <h1>digest · {night}</h1>
      <p>bad lines: {digest.badLines}</p>
      <table>
        <caption>Jobs for {night}</caption>
        <thead>
          <tr>
            <th scope="col">job</th>
            <th scope="col">owner</th>
            <th scope="col">runs</th>
            <th scope="col">retries</th>
            <th scope="col">failures</th>
            <th scope="col">last status</th>
            <th scope="col">last error</th>
            <th scope="col">first time</th>
            <th scope="col">last time</th>
          </tr>
        </thead>
        <tbody>
          {digest.rows.length === 0 ? (
            <tr><td colSpan={9}>nothing ran</td></tr>
          ) : digest.rows.map((row) => (
            <tr>
              <th scope="row">{row.job ?? '—'}</th>
              <td>{row.owner ?? '—'}</td>
              <td>{row.runs ?? '—'}</td>
              <td>{row.retries >= 3
                ? <strong class="warn">{row.retries} (high retries)</strong>
                : row.retries ?? '—'}</td>
              <td>{row.failures > 0
                ? <strong class="warn">{row.failures} (failure recorded)</strong>
                : row.failures ?? '—'}</td>
              <td>{row.lastStatus === 'fail'
                ? <strong class="warn">{row.lastStatus}</strong>
                : row.lastStatus ?? '—'}</td>
              <td>{row.lastError ?? '—'}</td>
              <td>{row.firstAt ?? '—'}</td>
              <td>{row.lastAt ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
