import type {
  DnsInfo,
  Fingerprint,
  RdapInfo,
  ReconData,
  SubdomainInfo,
} from "../types";

/**
 * Passive reconnaissance modules. Everything here is keyless, client-side and
 * built only from public data:
 *   - DNS-over-HTTPS (Cloudflare, then Google) for the DNS profile
 *   - RDAP (rdap.org) for domain registration facts
 *   - Certificate Transparency (crt.sh) for subdomain discovery
 *   - a local regex ruleset for HTML technology fingerprinting
 *
 * Each module is best-effort: any failure is captured as `error` and the rest of
 * the report still renders.
 */

const fetchWithTimeout = async (
  url: string,
  ms: number,
  init?: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const errMessage = (e: unknown): string => {
  const x = e as { name?: string; message?: string };
  if (x?.name === "AbortError") return "timed out";
  return x?.message || "unknown error";
};

export const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url
      .replace(/^https?:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/^www\./, "")
      .toLowerCase();
  }
};

/* ------------------------------------------------------------------ *
 * DNS over HTTPS
 * ------------------------------------------------------------------ */

const DOH_ENDPOINTS = [
  (name: string, type: string) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  (name: string, type: string) =>
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
];

const DNS_TYPE_NUM: Record<string, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  CAA: 257,
};

const cleanRecord = (type: string, data: string): string => {
  let out = data.trim();
  if (type === "TXT") {
    // DoH returns TXT data as one or more quoted chunks: "\"part1\" \"part2\"".
    out = out.replace(/^"(.*)"$/s, "$1").replace(/"\s+"/g, "");
  }
  if (type === "NS" || type === "CNAME" || type === "MX") {
    out = out.replace(/\.$/, "");
  }
  return out;
};

const dohQuery = async (name: string, type: string): Promise<string[]> => {
  const wantNum = DNS_TYPE_NUM[type];
  for (const build of DOH_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(build(name, type), 7000, {
        headers: { accept: "application/dns-json" },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const answers: unknown[] = Array.isArray(json?.Answer) ? json.Answer : [];
      const values = answers
        .map((a) => a as { type?: number; data?: unknown })
        .filter((a) => a?.type === wantNum && typeof a.data === "string")
        .map((a) => cleanRecord(type, a.data as string))
        .filter(Boolean);
      // A NOERROR response with no matching answers is still authoritative.
      if (values.length || json?.Status === 0) return [...new Set(values)];
    } catch {
      /* try the next resolver */
    }
  }
  return [];
};

const guessDnsProvider = (ns: string[]): string | undefined => {
  const joined = ns.join(" ").toLowerCase();
  const table: [RegExp, string][] = [
    [/cloudflare/, "Cloudflare"],
    [/awsdns/, "AWS Route 53"],
    [/domaincontrol\.com/, "GoDaddy"],
    [/googledomains|google\.com/, "Google Cloud DNS"],
    [/azure-dns/, "Azure DNS"],
    [/nsone\.net|dns1\.p0/, "NS1"],
    [/akam\.net|akamai/, "Akamai"],
    [/dnsmadeeasy/, "DNS Made Easy"],
    [/registrar-servers\.com/, "Namecheap"],
    [/hostinger/, "Hostinger"],
    [/digitalocean/, "DigitalOcean"],
    [/vercel-dns/, "Vercel"],
    [/netlify/, "Netlify"],
    [/dnsimple/, "DNSimple"],
    [/name-services\.com|worldnic/, "Network Solutions"],
  ];
  for (const [re, label] of table) if (re.test(joined)) return label;
  return undefined;
};

const guessMailProvider = (mx: string[]): string | undefined => {
  const joined = mx.join(" ").toLowerCase();
  if (!joined) return undefined;
  const table: [RegExp, string][] = [
    [/aspmx\.l\.google\.com|googlemail\.com/, "Google Workspace"],
    [/protection\.outlook\.com|mail\.protection/, "Microsoft 365"],
    [/zoho/, "Zoho Mail"],
    [/pphosted|proofpoint/, "Proofpoint"],
    [/mimecast/, "Mimecast"],
    [/messagingengine\.com/, "Fastmail"],
    [/secureserver\.net/, "GoDaddy Email"],
    [/mx\.cloudflare\.net/, "Cloudflare Email Routing"],
    [/improvmx/, "ImprovMX"],
    [/forwardemail/, "Forward Email"],
    [/amazonaws\.com|amazonses/, "Amazon SES"],
    [/titan\.email/, "Titan Email"],
  ];
  for (const [re, label] of table) if (re.test(joined)) return label;
  return "Self-hosted / other";
};

export const resolveDns = async (domain: string): Promise<DnsInfo> => {
  try {
    const [a, aaaa, ns, mx, txt, cname, caa, dmarcTxt] = await Promise.all([
      dohQuery(domain, "A"),
      dohQuery(domain, "AAAA"),
      dohQuery(domain, "NS"),
      dohQuery(domain, "MX"),
      dohQuery(domain, "TXT"),
      dohQuery(domain, "CNAME"),
      dohQuery(domain, "CAA"),
      dohQuery(`_dmarc.${domain}`, "TXT"),
    ]);

    const info: DnsInfo = {
      a,
      aaaa,
      ns,
      mx,
      txt,
      cname,
      caa,
      spf: txt.find((t) => /^v=spf1\b/i.test(t)),
      dmarc: dmarcTxt.find((t) => /^v=DMARC1\b/i.test(t)),
      provider: guessDnsProvider(ns),
      mailProvider: guessMailProvider(mx),
    };
    if (!a.length && !aaaa.length && !ns.length) {
      info.error = "No DNS records resolved.";
    }
    return info;
  } catch (e) {
    return {
      a: [],
      aaaa: [],
      ns: [],
      mx: [],
      txt: [],
      cname: [],
      caa: [],
      error: errMessage(e),
    };
  }
};

/* ------------------------------------------------------------------ *
 * RDAP (WHOIS successor)
 * ------------------------------------------------------------------ */

const vcardName = (entity: unknown): string | undefined => {
  const arr = (entity as { vcardArray?: unknown[] })?.vcardArray;
  const props = Array.isArray(arr) && Array.isArray(arr[1]) ? (arr[1] as unknown[]) : [];
  for (const prop of props) {
    if (Array.isArray(prop) && prop[0] === "fn" && typeof prop[3] === "string") {
      return prop[3];
    }
  }
  return undefined;
};

/** Authoritative registry RDAP endpoints, tried if rdap.org is unreachable. */
const REGISTRY_RDAP: Record<string, string> = {
  com: "https://rdap.verisign.com/com/v1/domain/",
  net: "https://rdap.verisign.com/net/v1/domain/",
  org: "https://rdap.publicinterestregistry.org/rdap/domain/",
  io: "https://rdap.identitydigital.services/rdap/domain/",
};

const parseRdap = (
  domain: string,
  json: Record<string, unknown>,
): RdapInfo => {
  const events: { eventAction?: string; eventDate?: string }[] = Array.isArray(
    json.events,
  )
    ? (json.events as { eventAction?: string; eventDate?: string }[])
    : [];
  const dateFor = (action: string) =>
    events.find((e) => e?.eventAction === action)?.eventDate;

  const created = dateFor("registration");
  const expires = dateFor("expiration");
  const updated =
    dateFor("last changed") || dateFor("last update of RDAP database");

  let registrar: string | undefined;
  const entities: unknown[] = Array.isArray(json.entities) ? json.entities : [];
  for (const ent of entities) {
    const roles = (ent as { roles?: string[] })?.roles;
    if (Array.isArray(roles) && roles.includes("registrar")) {
      registrar = vcardName(ent) || (ent as { handle?: string })?.handle;
      break;
    }
  }

  const statuses: string[] = Array.isArray(json.status)
    ? (json.status as string[])
    : [];
  const nameservers: string[] = (Array.isArray(json.nameservers)
    ? (json.nameservers as { ldhName?: string }[])
    : []
  )
    .map((n) => (n?.ldhName || "").toLowerCase())
    .filter(Boolean);

  const createdMs = created ? Date.parse(created) : NaN;
  const ageDays = Number.isNaN(createdMs)
    ? undefined
    : Math.max(0, Math.floor((Date.now() - createdMs) / 86_400_000));

  const secureDNS = json.secureDNS as { delegationSigned?: unknown } | undefined;

  return {
    domain: (json.ldhName as string) || domain,
    registrar,
    created,
    expires,
    updated,
    ageDays,
    statuses,
    nameservers,
    dnssec:
      typeof secureDNS?.delegationSigned === "boolean"
        ? secureDNS.delegationSigned
        : undefined,
  };
};

export const lookupRdap = async (domain: string): Promise<RdapInfo> => {
  const tld = domain.split(".").pop() || "";
  const candidates = [
    `https://rdap.org/domain/${encodeURIComponent(domain)}`,
    ...(REGISTRY_RDAP[tld]
      ? [REGISTRY_RDAP[tld] + encodeURIComponent(domain)]
      : []),
  ];

  let lastError = "RDAP lookup failed.";
  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, 9000, {
        headers: { accept: "application/rdap+json" },
      });
      if (!res.ok) {
        lastError =
          res.status === 404
            ? "No RDAP record (unregistered or unsupported TLD)."
            : `RDAP HTTP ${res.status}`;
        continue;
      }
      let json: Record<string, unknown>;
      try {
        json = await res.json();
      } catch {
        lastError = "RDAP returned a non-JSON response.";
        continue;
      }
      const looksLikeDomain =
        json &&
        typeof json === "object" &&
        (json.objectClassName === "domain" ||
          typeof json.ldhName === "string" ||
          Array.isArray(json.events));
      if (!looksLikeDomain) {
        lastError = "RDAP response missing registration data.";
        continue;
      }
      return parseRdap(domain, json);
    } catch (e) {
      lastError = errMessage(e);
    }
  }
  return { statuses: [], nameservers: [], error: lastError };
};

/* ------------------------------------------------------------------ *
 * Certificate Transparency (subdomain discovery)
 * ------------------------------------------------------------------ */

export const discoverSubdomains = async (
  domain: string,
): Promise<SubdomainInfo> => {
  const target = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  const empty = (error: string): SubdomainInfo => ({
    subdomains: [],
    count: 0,
    truncated: false,
    error,
  });

  const grab = async (u: string): Promise<string> => {
    const res = await fetchWithTimeout(u, 15000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };

  let raw: string;
  try {
    raw = await grab(target);
  } catch {
    try {
      raw = await grab(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
      );
    } catch {
      return empty("Certificate Transparency lookup unavailable.");
    }
  }

  let rows: unknown[];
  try {
    rows = JSON.parse(raw);
  } catch {
    // crt.sh occasionally emits newline-delimited JSON objects.
    try {
      rows = JSON.parse(`[${raw.trim().split("\n").filter(Boolean).join(",")}]`);
    } catch {
      return empty("Could not parse Certificate Transparency response.");
    }
  }
  if (!Array.isArray(rows)) return empty("Unexpected Certificate Transparency response.");

  const set = new Set<string>();
  for (const row of rows) {
    const r = row as { name_value?: unknown; common_name?: unknown };
    const blob = `${String(r?.name_value ?? "")}\n${String(r?.common_name ?? "")}`;
    for (const piece of blob.split(/\n/)) {
      const name = piece.trim().toLowerCase().replace(/^\*\./, "");
      if (!name || /\s/.test(name)) continue;
      if (name === domain || name.endsWith(`.${domain}`)) set.add(name);
    }
  }

  const all = [...set].sort();
  const LIMIT = 80;
  return {
    subdomains: all.slice(0, LIMIT),
    count: all.length,
    truncated: all.length > LIMIT,
  };
};

/* ------------------------------------------------------------------ *
 * Local HTML technology fingerprint
 * ------------------------------------------------------------------ */

interface Rule {
  name: string;
  category: string;
  test: RegExp;
  /** Optional capture of a version / ID; group 1 is used. */
  version?: RegExp;
  /** When true and `test` has a capture group, group 1 becomes the version. */
  idAsVersion?: boolean;
}

const RULES: Rule[] = [
  // --- CMS / site builders ---
  {
    name: "WordPress",
    category: "CMS",
    test: /wp-content\/|wp-includes\/|\/wp-json\b/i,
    version: /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress\s+([\d.]+)/i,
  },
  { name: "WooCommerce", category: "E-commerce", test: /woocommerce/i },
  {
    name: "Elementor",
    category: "Page Builder",
    test: /elementor-frontend|\/elementor\/(?:assets|v)/i,
  },
  { name: "Divi", category: "Page Builder", test: /et_pb_|\/themes\/Divi\//i },
  { name: "Yoast SEO", category: "SEO", test: /yoast|wpseo/i },
  {
    name: "Shopify",
    category: "E-commerce",
    test: /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i,
  },
  { name: "Wix", category: "Site Builder", test: /wixstatic\.com|static\.wixstatic|X-Wix-/i },
  {
    name: "Squarespace",
    category: "Site Builder",
    test: /squarespace\.com|static1\.squarespace|SQUARESPACE_CONTEXT/i,
  },
  {
    name: "Webflow",
    category: "Site Builder",
    test: /assets\.website-files\.com|assets-global\.website-files\.com|data-wf-page/i,
  },
  { name: "Drupal", category: "CMS", test: /sites\/(?:all|default)\/(?:files|modules)|Drupal\.settings/i },
  { name: "Joomla", category: "CMS", test: /\/media\/jui\/|com_content|Joomla!/i },
  { name: "Ghost", category: "CMS", test: /content\/themes\/[^"']+\/assets|ghost-sdk|data-ghost/i },
  { name: "HubSpot CMS", category: "CMS", test: /hs-scripts\.com|hubspotusercontent|hs-analytics/i, version: /js\.hs-scripts\.com\/(\d+)/i },

  // --- JS frameworks ---
  { name: "Next.js", category: "Framework", test: /\/_next\/static\/|__NEXT_DATA__/i },
  { name: "Nuxt", category: "Framework", test: /\/_nuxt\/|__NUXT__|window\.__NUXT__/i },
  { name: "Gatsby", category: "Framework", test: /\/___gatsby|id=["']___gatsby["']|gatsby-chunk-mapping/i },
  { name: "SvelteKit", category: "Framework", test: /\/_app\/immutable\/|__sveltekit/i },
  { name: "Remix", category: "Framework", test: /__remixContext|\/build\/_shared\/|window\.__remix/i },
  { name: "Astro", category: "Framework", test: /astro-island|<astro-|\/_astro\//i },
  {
    name: "React",
    category: "JS Library",
    test: /data-reactroot|react-dom(?:\.production)?(?:\.min)?\.js|_reactListening|__REACT_DEVTOOLS_GLOBAL_HOOK__/i,
    version: /react(?:-dom)?@([\d.]+)/i,
  },
  {
    name: "Vue.js",
    category: "JS Library",
    test: /vue(?:\.runtime)?(?:\.global)?(?:\.min)?\.js|data-v-[0-9a-f]{6,}|__VUE__|id=["']app["'][^>]*data-v-app/i,
    version: /vue@([\d.]+)/i,
  },
  {
    name: "Angular",
    category: "Framework",
    test: /ng-version=["'][\d.]+["']|\/@angular\/|angular(?:\.min)?\.js/i,
    version: /ng-version=["']([\d.]+)["']/i,
  },
  {
    name: "jQuery",
    category: "JS Library",
    test: /jquery(?:[-.]?\d[\d.]*)?(?:\.slim)?(?:\.min)?\.js|jQuery\.fn\.jquery/i,
    version: /jquery[-/]?v?([\d]+\.[\d]+\.[\d]+)(?:\.slim)?(?:\.min)?\.js/i,
  },
  { name: "Alpine.js", category: "JS Library", test: /alpinejs|x-data=|cdn\.jsdelivr\.net\/npm\/alpinejs/i },
  { name: "HTMX", category: "JS Library", test: /htmx\.org|hx-get=|hx-post=/i },

  // --- CSS / UI ---
  {
    name: "Tailwind CSS",
    category: "CSS Framework",
    test: /cdn\.tailwindcss\.com|tailwind(?:\.min)?\.css|--tw-[a-z-]+:/i,
  },
  {
    name: "Bootstrap",
    category: "CSS Framework",
    test: /bootstrap(?:\.bundle)?(?:\.min)?\.(?:css|js)|class=["'][^"']*\b(?:container|row|col-(?:xs|sm|md|lg|xl))\b/i,
    version: /bootstrap@([\d.]+)|bootstrap\/([\d.]+)/i,
  },
  { name: "Font Awesome", category: "Icons", test: /font-?awesome|fa-(?:solid|regular|brands|light)|kit\.fontawesome\.com/i },
  { name: "Google Fonts", category: "Fonts", test: /fonts\.googleapis\.com|fonts\.gstatic\.com/i },
  { name: "Bulma", category: "CSS Framework", test: /bulma(?:\.min)?\.css/i },

  // --- Analytics / marketing ---
  {
    name: "Google Analytics (GA4)",
    category: "Analytics",
    test: /gtag\/js\?id=G-[A-Z0-9]+|google-analytics\.com\/g\/collect/i,
    version: /\b(G-[A-Z0-9]{6,})\b/,
    idAsVersion: true,
  },
  {
    name: "Universal Analytics",
    category: "Analytics",
    test: /\b(UA-\d{4,}-\d+)\b/,
    version: /\b(UA-\d{4,}-\d+)\b/,
    idAsVersion: true,
  },
  {
    name: "Google Tag Manager",
    category: "Tag Manager",
    test: /googletagmanager\.com\/gtm\.js|\b(GTM-[A-Z0-9]+)\b/i,
    version: /\b(GTM-[A-Z0-9]+)\b/i,
    idAsVersion: true,
  },
  {
    name: "Meta Pixel",
    category: "Advertising",
    test: /connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(\s*['"]init['"]/i,
    version: /fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,})['"]/i,
  },
  { name: "Hotjar", category: "Analytics", test: /static\.hotjar\.com|hjSiteSettings|_hjSettings/i, version: /hjid\s*:\s*(\d+)/i },
  { name: "Microsoft Clarity", category: "Analytics", test: /clarity\.ms\/tag|clarity\("set"/i },
  { name: "Segment", category: "Analytics", test: /cdn\.segment\.com\/analytics\.js|analytics\.load\(/i },
  { name: "Plausible", category: "Analytics", test: /plausible\.io\/js|data-domain=/i },
  { name: "Mixpanel", category: "Analytics", test: /cdn\.mxpnl\.com|mixpanel\.init/i },
  { name: "LinkedIn Insight", category: "Advertising", test: /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id/i },
  { name: "TikTok Pixel", category: "Advertising", test: /analytics\.tiktok\.com|ttq\.load/i },

  // --- Infra / delivery / security ---
  { name: "Cloudflare", category: "CDN / Security", test: /cdn-cgi\/(?:scripts|challenge-platform|trace)|__cf_bm|cf-ray/i },
  { name: "Fastly", category: "CDN", test: /\.fastly\.net|x-served-by:\s*cache/i },
  { name: "Amazon CloudFront", category: "CDN", test: /\.cloudfront\.net/i },
  { name: "jsDelivr", category: "CDN", test: /cdn\.jsdelivr\.net/i },
  { name: "Akamai", category: "CDN", test: /akamaized\.net|akamaihd\.net/i },
  { name: "reCAPTCHA", category: "Security", test: /www\.google\.com\/recaptcha|recaptcha\/api\.js|grecaptcha/i },
  { name: "Cloudflare Turnstile", category: "Security", test: /challenges\.cloudflare\.com\/turnstile/i },
  { name: "hCaptcha", category: "Security", test: /hcaptcha\.com\/1\/api\.js|h-captcha/i },

  // --- Payments / commerce / support ---
  { name: "Stripe", category: "Payments", test: /js\.stripe\.com/i },
  { name: "PayPal", category: "Payments", test: /www\.paypal(?:objects)?\.com|paypal\.com\/sdk\/js/i },
  { name: "Intercom", category: "Support", test: /widget\.intercom\.io|intercomSettings/i },
  { name: "Zendesk", category: "Support", test: /static\.zdassets\.com|zE\(|zendesk/i },
  { name: "Drift", category: "Support", test: /js\.driftt\.com|drift\.load/i },
  { name: "Tawk.to", category: "Support", test: /embed\.tawk\.to/i },

  // --- Hosting hints in markup ---
  { name: "Vercel", category: "Hosting", test: /\.vercel\.app|x-vercel-|__vercel_/i },
  { name: "Netlify", category: "Hosting", test: /\.netlify\.app|netlify\.com\/img|__netlify/i },
  { name: "GitHub Pages", category: "Hosting", test: /\.github\.io/i },
  { name: "WP Engine", category: "Hosting", test: /wpengine\.com|wpenginepowered/i },
];

const clip = (s: string, n = 80): string =>
  s.replace(/\s+/g, " ").trim().slice(0, n);

export const fingerprint = (html: string): Fingerprint[] => {
  if (!html) return [];
  const found = new Map<string, Fingerprint>();

  for (const rule of RULES) {
    const match = new RegExp(rule.test.source, rule.test.flags.replace("g", "")).exec(
      html,
    );
    if (!match) continue;

    let version: string | undefined;
    if (rule.version) {
      const vm = new RegExp(
        rule.version.source,
        rule.version.flags.replace("g", ""),
      ).exec(html);
      if (vm) version = (vm[1] || vm[2])?.trim();
    }
    if (!version && rule.idAsVersion && match[1]) version = match[1].trim();

    if (!found.has(rule.name)) {
      found.set(rule.name, {
        name: rule.name,
        category: rule.category,
        version,
        evidence: clip(match[0]),
      });
    }
  }

  return [...found.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
};

/* ------------------------------------------------------------------ *
 * Orchestration + prompt serialisation
 * ------------------------------------------------------------------ */

export const runRecon = async (
  url: string,
  html: string | null,
  onLog: (message: string) => void,
): Promise<ReconData> => {
  const domain = getDomain(url);
  onLog(`Recon: DNS-over-HTTPS, RDAP and Certificate Transparency for ${domain}...`);

  const [dnsR, rdapR, subR] = await Promise.allSettled([
    resolveDns(domain),
    lookupRdap(domain),
    discoverSubdomains(domain),
  ]);

  const dns = dnsR.status === "fulfilled" ? dnsR.value : undefined;
  const rdap = rdapR.status === "fulfilled" ? rdapR.value : undefined;
  const subdomains = subR.status === "fulfilled" ? subR.value : undefined;
  const fingerprints = html ? fingerprint(html) : [];

  if (dns) {
    onLog(
      dns.error
        ? `Recon: DNS lookup failed (${dns.error})`
        : `Recon: DNS ok - ${dns.a.length} A, ${dns.ns.length} NS, ${dns.mx.length} MX${
            dns.provider ? `, DNS via ${dns.provider}` : ""
          }.`,
    );
  }
  if (rdap) {
    onLog(
      rdap.error
        ? `Recon: RDAP unavailable (${rdap.error})`
        : `Recon: RDAP ok - registrar ${rdap.registrar || "n/a"}${
            rdap.ageDays != null
              ? `, domain ~${(rdap.ageDays / 365).toFixed(1)} yr old`
              : ""
          }.`,
    );
  }
  if (subdomains) {
    onLog(
      subdomains.error
        ? `Recon: Certificate Transparency unavailable (${subdomains.error})`
        : `Recon: Certificate Transparency - ${subdomains.count} subdomain(s) observed.`,
    );
  }
  onLog(
    `Recon: HTML fingerprint matched ${fingerprints.length} technolog${
      fingerprints.length === 1 ? "y" : "ies"
    }.`,
  );

  return { dns, rdap, subdomains, fingerprints };
};

/** Compact, LLM-friendly rendering of the recon data. Returns "" when empty. */
export const reconToPromptText = (recon: ReconData): string => {
  const lines: string[] = [];
  const { dns, rdap, subdomains, fingerprints } = recon;

  if (dns && !dns.error) {
    const d: string[] = ["DNS:"];
    if (dns.a.length) d.push(`- A: ${dns.a.join(", ")}`);
    if (dns.aaaa.length) d.push(`- AAAA: ${dns.aaaa.join(", ")}`);
    if (dns.cname.length) d.push(`- CNAME: ${dns.cname.join(", ")}`);
    if (dns.ns.length)
      d.push(`- NS: ${dns.ns.join(", ")}${dns.provider ? `  (provider: ${dns.provider})` : ""}`);
    if (dns.mx.length)
      d.push(`- MX: ${dns.mx.join(", ")}${dns.mailProvider ? `  (mail: ${dns.mailProvider})` : ""}`);
    if (dns.spf) d.push(`- SPF: ${dns.spf}`);
    d.push(`- DMARC: ${dns.dmarc || "not published"}`);
    if (dns.caa.length) d.push(`- CAA: ${dns.caa.join(", ")}`);
    if (d.length > 1) lines.push(d.join("\n"));
  }

  if (rdap && !rdap.error) {
    const r: string[] = ["DOMAIN (RDAP):"];
    if (rdap.registrar) r.push(`- Registrar: ${rdap.registrar}`);
    if (rdap.created)
      r.push(
        `- Created: ${rdap.created.slice(0, 10)}${
          rdap.ageDays != null ? `  (~${(rdap.ageDays / 365).toFixed(1)} years old)` : ""
        }`,
      );
    if (rdap.expires) r.push(`- Expires: ${rdap.expires.slice(0, 10)}`);
    if (rdap.statuses.length) r.push(`- Status: ${rdap.statuses.join(", ")}`);
    if (typeof rdap.dnssec === "boolean")
      r.push(`- DNSSEC: ${rdap.dnssec ? "signed" : "unsigned"}`);
    if (r.length > 1) lines.push(r.join("\n"));
  }

  if (subdomains && !subdomains.error && subdomains.count > 0) {
    const shown = subdomains.subdomains.slice(0, 40);
    lines.push(
      `SUBDOMAINS (Certificate Transparency, ${subdomains.count} found):\n${shown.join(
        ", ",
      )}${subdomains.count > shown.length ? ", ..." : ""}`,
    );
  }

  if (fingerprints && fingerprints.length) {
    lines.push(
      `DETECTED TECH (local fingerprint of served HTML):\n${fingerprints
        .map(
          (f) => `- ${f.name}${f.version ? ` ${f.version}` : ""} [${f.category}]`,
        )
        .join("\n")}`,
    );
  }

  if (!lines.length) return "";
  return [
    "RECON_DATA (measured from DNS, RDAP, Certificate Transparency logs and a local HTML fingerprint - treat as authoritative ground truth and prefer it over inference):",
    ...lines,
  ].join("\n\n");
};
