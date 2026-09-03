
export interface TechStackInfo {
  cms?: string;
  theme?: string;
  hosting?: string;
  domainRegistrar?: string;
  frontendFrameworks?: string[];
  analytics?: string[];
  marketingScripts?: string[];
  plugins?: string[];
  otherTech?: string[];
  securityHeaders?: string[];
  networkForensics?: string[];
  behavioralIndicators?: string[];
  summary?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

/** Passive DNS profile, resolved over DNS-over-HTTPS. */
export interface DnsInfo {
  a: string[];
  aaaa: string[];
  ns: string[];
  mx: string[];
  txt: string[];
  cname: string[];
  caa: string[];
  spf?: string;
  dmarc?: string;
  /** Guessed from the NS records (e.g. "Cloudflare", "AWS Route 53"). */
  provider?: string;
  /** Guessed from the MX records (e.g. "Google Workspace", "Microsoft 365"). */
  mailProvider?: string;
  error?: string;
}

/** Domain registration facts from RDAP (the successor to WHOIS). */
export interface RdapInfo {
  domain?: string;
  registrar?: string;
  created?: string;
  expires?: string;
  updated?: string;
  ageDays?: number;
  statuses: string[];
  nameservers: string[];
  dnssec?: boolean;
  error?: string;
}

/** Subdomains observed in public Certificate Transparency logs (crt.sh). */
export interface SubdomainInfo {
  subdomains: string[];
  count: number;
  truncated: boolean;
  error?: string;
}

/** A single technology matched by the local HTML fingerprint pass. */
export interface Fingerprint {
  name: string;
  category: string;
  version?: string;
  evidence: string;
}

export interface ReconData {
  dns?: DnsInfo;
  rdap?: RdapInfo;
  subdomains?: SubdomainInfo;
  fingerprints?: Fingerprint[];
}

export interface AnalysisResult {
  url: string;
  techStack: TechStackInfo;
  sources: GroundingSource[];
  rawText: string;
  recon?: ReconData;
}
