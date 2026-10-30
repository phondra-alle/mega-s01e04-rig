export type DigestStatus = "ok" | "retry" | "fail";

/** One row per job, aggregated from valid log entries. */
export type DigestRow = {
  job: string;
  /** Owner from the chronologically last entry, including null. */
  owner: string | null;
  /** Total entries; ok count is runs - retries - failures. */
  runs: number;
  /** Number of retry entries. */
  retries: number;
  /** Number of fail entries, even when followed by ok. */
  failures: number;
  /** Status from the chronologically last entry. */
  lastStatus: DigestStatus;
  /** Chronologically last recorded error; later ok entries do not clear it. */
  lastError: string | null;
  /** Chronologically first timestamp, preserving its original string and offset. */
  firstAt: string;
  /** Chronologically last timestamp, preserving its original string and offset. */
  lastAt: string;
};

export type NightDigest = {
  /** Shared ordering for all consumers: ascending lexicographic order by job. */
  rows: DigestRow[];
  /** Number of invalid log lines excluded from the rows. */
  badLines: number;
};

/**
 * null means a missing file or an invalid night name.
 * An empty file yields { rows: [], badLines: 0 }.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
