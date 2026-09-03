import React from 'react';
import {
  Network,
  CalendarClock,
  Fingerprint,
  ShieldCheck,
  ListTree,
  AlertTriangle,
} from 'lucide-react';
import { ReconData } from '../types';

interface ReconPanelProps {
  recon?: ReconData;
}

const Card: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children }) => (
  <div className="bg-slate-900/40 border border-slate-700/50 rounded-2xl p-5 sm:p-6 flex flex-col gap-4 shadow-inner">
    <div className="flex items-center gap-3">
      <div className="p-2.5 bg-slate-800/80 rounded-xl text-blue-400 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 leading-none">
          {title}
        </h4>
        {subtitle && (
          <p className="text-[11px] text-slate-500 mt-1 truncate font-mono">{subtitle}</p>
        )}
      </div>
    </div>
    <div className="text-xs text-slate-300 space-y-2 leading-relaxed">{children}</div>
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3">
    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 sm:w-24 flex-shrink-0 pt-0.5">
      {label}
    </span>
    <span className="font-mono text-[11px] text-slate-300 break-all min-w-0">{children}</span>
  </div>
);

const Pill: React.FC<{ children: React.ReactNode; tone?: 'default' | 'good' | 'warn' }> = ({
  children,
  tone = 'default',
}) => {
  const tones = {
    default: 'bg-slate-800 text-slate-300 border-slate-700',
    good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warn: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-mono mr-1.5 mb-1.5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
};

const Empty: React.FC<{ msg: string }> = ({ msg }) => (
  <p className="flex items-center gap-2 text-[11px] text-slate-500">
    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
    {msg}
  </p>
);

const fmtDate = (iso?: string): string => {
  if (!iso) return 'Not observed';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
};

export const ReconPanel: React.FC<ReconPanelProps> = ({ recon }) => {
  if (!recon) return null;
  const { dns, rdap, subdomains, fingerprints } = recon;
  if (!dns && !rdap && !subdomains && !(fingerprints && fingerprints.length)) return null;

  const ageYears =
    rdap?.ageDays != null ? (rdap.ageDays / 365).toFixed(1) : undefined;

  return (
    <section className="mt-4 mb-10 no-pdf animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-6 w-1 rounded-full bg-blue-600" />
        <h3 className="text-lg md:text-xl font-black tracking-tight uppercase text-white">
          Passive Reconnaissance
        </h3>
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 border border-slate-700 rounded-md px-2 py-1">
          Measured
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* DNS */}
        <Card
          icon={<Network className="w-4 h-4" />}
          title="DNS Profile"
          subtitle={dns?.provider ? `DNS via ${dns.provider}` : 'DNS-over-HTTPS'}
        >
          {!dns || dns.error ? (
            <Empty msg={dns?.error || 'DNS data unavailable.'} />
          ) : (
            <>
              {dns.a.length > 0 && (
                <Row label="A">{dns.a.join(', ')}</Row>
              )}
              {dns.aaaa.length > 0 && <Row label="AAAA">{dns.aaaa.join(', ')}</Row>}
              {dns.cname.length > 0 && <Row label="CNAME">{dns.cname.join(', ')}</Row>}
              {dns.ns.length > 0 && <Row label="NS">{dns.ns.join(', ')}</Row>}
              <Row label="Mail">
                {dns.mx.length > 0 ? (
                  <>
                    {dns.mailProvider && <Pill tone="good">{dns.mailProvider}</Pill>}
                    <br />
                    {dns.mx.join(', ')}
                  </>
                ) : (
                  'No MX records'
                )}
              </Row>
              <Row label="SPF">
                {dns.spf ? <Pill tone="good">present</Pill> : <Pill tone="warn">missing</Pill>}
              </Row>
              <Row label="DMARC">
                {dns.dmarc ? (
                  <>
                    <Pill tone="good">present</Pill>
                    {dns.dmarc}
                  </>
                ) : (
                  <Pill tone="warn">not published</Pill>
                )}
              </Row>
              {dns.caa.length > 0 && <Row label="CAA">{dns.caa.join(', ')}</Row>}
            </>
          )}
        </Card>

        {/* RDAP */}
        <Card
          icon={<CalendarClock className="w-4 h-4" />}
          title="Domain Registration"
          subtitle="RDAP"
        >
          {!rdap || rdap.error ? (
            <Empty msg={rdap?.error || 'Registration data unavailable.'} />
          ) : (
            <>
              <Row label="Registrar">{rdap.registrar || 'Not observed'}</Row>
              <Row label="Created">
                {fmtDate(rdap.created)}
                {ageYears && (
                  <span className="text-slate-500"> {`· ~${ageYears} yr old`}</span>
                )}
              </Row>
              <Row label="Expires">{fmtDate(rdap.expires)}</Row>
              {rdap.updated && <Row label="Updated">{fmtDate(rdap.updated)}</Row>}
              <Row label="DNSSEC">
                {rdap.dnssec === true ? (
                  <Pill tone="good">signed</Pill>
                ) : rdap.dnssec === false ? (
                  <Pill tone="warn">unsigned</Pill>
                ) : (
                  'Not observed'
                )}
              </Row>
              {rdap.statuses.length > 0 && (
                <Row label="Status">
                  {rdap.statuses.map((s) => (
                    <Pill key={s}>{s}</Pill>
                  ))}
                </Row>
              )}
            </>
          )}
        </Card>

        {/* Subdomains */}
        <Card
          icon={<ListTree className="w-4 h-4" />}
          title="Subdomains"
          subtitle={
            subdomains && !subdomains.error
              ? `${subdomains.count} in Certificate Transparency logs`
              : 'Certificate Transparency (crt.sh)'
          }
        >
          {!subdomains || subdomains.error ? (
            <Empty msg={subdomains?.error || 'Certificate Transparency data unavailable.'} />
          ) : subdomains.count === 0 ? (
            <Empty msg="No subdomains found in public CT logs." />
          ) : (
            <div className="max-h-52 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-700">
              {subdomains.subdomains.map((s) => (
                <Pill key={s}>{s}</Pill>
              ))}
              {subdomains.truncated && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Showing first {subdomains.subdomains.length} of {subdomains.count}.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* Fingerprint */}
        <Card
          icon={<Fingerprint className="w-4 h-4" />}
          title="Detected Technologies"
          subtitle={
            fingerprints && fingerprints.length
              ? `${fingerprints.length} matched in served HTML`
              : 'Local HTML fingerprint'
          }
        >
          {!fingerprints || fingerprints.length === 0 ? (
            <Empty msg="No technologies matched the local ruleset (source may not have been retrieved)." />
          ) : (
            <div className="max-h-52 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-700 space-y-2">
              {fingerprints.map((f) => (
                <div key={f.name} className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] text-slate-200 font-semibold">
                    {f.name}
                    {f.version && (
                      <span className="text-blue-400 font-mono"> {f.version}</span>
                    )}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex-shrink-0">
                    {f.category}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="flex items-center gap-2 mt-4 text-[10px] text-slate-600">
        <ShieldCheck className="w-3.5 h-3.5" />
        Passive lookups only — no scanning or intrusion. Sources: Cloudflare DoH, rdap.org, crt.sh.
      </div>
    </section>
  );
};
