import { serve } from "https://deno.land/std@0.181.0/http/server.ts";

const dunno = "Unknown";

/* --------------------------- AUTHORIZATION --------------------------- */
/**
 * Verifies that the request’s “Authorization” header matches the token
 * specified in the AUTH_TOKEN environment variable.
 */
async function verifyAuth(
  req: Request,
): Promise<{ success: boolean; error?: string }> {
  const authHeader = req.headers.get("authorization");
  const token = Deno.env.get("AUTH_TOKEN") || "";
  return authHeader === `Bearer ${token}`
    ? { success: true }
    : { success: false, error: "Unauthorized" };
}

/* --------------------------- HELPER FUNCTIONS --------------------------- */
/**
 * If the domain appears to be a subdomain, return its parent.
 */
function getParentDomain(domain: string): string {
  const parts = domain.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : domain;
}

/**
 * Runs an async function and catches errors by appending an error message.
 */
async function safeExecute<T>(
  fn: () => Promise<T>,
  errorMsg: string,
  errors: string[],
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error(errorMsg, e);
    errors.push(errorMsg);
    return undefined;
  }
}

/* --------------------------- WHOIS / RDAP LOOKUP --------------------------- */
/**
 * Retrieves RDAP data for the given domain.
 * Uses rdap.verisign.com for “.com” domains and rdap.org for others.
 */
async function getWhoisData(domain: string): Promise<any | null> {
  const lower = domain.toLowerCase();
  const url = lower.endsWith(".com")
    ? `https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(domain)}`
    : `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("RDAP fetch failed", res.status);
    return null;
  }
  const rdap = await res.json();
  return rdapToWhois(rdap);
}

function findAbuse(entities: any[]): any {
  for (const e of entities) {
    if (e.roles && e.roles.includes("abuse") && e.vcardArray) return e;
    if (e.entities) {
      const found = findAbuse(e.entities);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Maps an RDAP response into a legacy WHOIS‑style object.
 */
function rdapToWhois(rdap: any): any {
  const domainName = rdap.ldhName || dunno;
  const statusArray = Array.isArray(rdap.status) ? rdap.status : [];
  // If the only status is "client transfer prohibited", return an empty array.
  const domainStatus = statusArray.length === 1 &&
      statusArray[0].toLowerCase() === "client transfer prohibited"
    ? []
    : statusArray;
  let creationDate = "";
  let updatedDate = "";
  let expiryDate = "";
  if (Array.isArray(rdap.events)) {
    for (const ev of rdap.events) {
      if (ev.eventAction === "registration") {
        creationDate = ev.eventDate;
      } else if (ev.eventAction === "expiration") {
        expiryDate = ev.eventDate;
      } else if (
        ev.eventAction === "last changed" || ev.eventAction === "last update"
      ) {
        updatedDate = ev.eventDate;
      }
    }
  }
  // Registrar information
  let registrarName = dunno;
  let registrarIanaId = dunno;
  let registrarUrl = dunno;
  let registryDomainId = dunno;
  if (Array.isArray(rdap.entities)) {
    const regEntity = rdap.entities.find((e: any) =>
      e.roles && e.roles.includes("registrar")
    );
    if (regEntity) {
      registrarName =
        regEntity.vcardArray && getVCardField(regEntity.vcardArray, "fn")
          ? getVCardField(regEntity.vcardArray, "fn") as string
          : dunno;
      registrarIanaId = regEntity.handle || dunno;
      if (Array.isArray(regEntity.links)) {
        const link = regEntity.links.find((l: any) => l.rel === "self");
        registrarUrl = link ? link.href : dunno;
      }
      registryDomainId = regEntity.handle || dunno;
    }
  }
  // If registrar is Cloudflare, Inc. but no URL is provided, override it.
  if (
    registrarName === "Cloudflare, Inc." &&
    (registrarUrl === dunno || !registrarUrl)
  ) {
    registrarUrl = "https://www.cloudflare.com";
  }
  // Registrant (WHOIS) information from an entity with role "registrant"
  let registrantName = dunno;
  let registrantOrganization = dunno;
  let registrantStreet = dunno;
  let registrantCity = dunno;
  let registrantCountry = dunno;
  let registrantStateProvince = dunno;
  let registrantPostalCode = dunno;
  if (Array.isArray(rdap.entities)) {
    const regEntity = rdap.entities.find((e: any) =>
      e.roles && e.roles.includes("registrant")
    );
    if (regEntity && regEntity.vcardArray) {
      registrantName = getVCardField(regEntity.vcardArray, "fn") || dunno;
      registrantOrganization = getVCardField(regEntity.vcardArray, "org") ||
        dunno;
      registrantStreet = getVCardField(regEntity.vcardArray, "street") || dunno;
      registrantCity = getVCardField(regEntity.vcardArray, "locality") || dunno;
      registrantCountry = getVCardField(regEntity.vcardArray, "country-name") ||
        dunno;
      registrantStateProvince = getVCardField(regEntity.vcardArray, "region") ||
        dunno;
      registrantPostalCode =
        getVCardField(regEntity.vcardArray, "postal-code") || dunno;
    }
  }
  // Abuse contact information from an entity with role "abuse" (searched recursively)
  let abuseContactEmail = dunno;
  let abuseContactPhone = dunno;
  if (Array.isArray(rdap.entities)) {
    const abuseEntity = findAbuse(rdap.entities);
    if (abuseEntity && abuseEntity.vcardArray) {
      abuseContactEmail = getVCardField(abuseEntity.vcardArray, "email") ||
        dunno;
      abuseContactPhone = getVCardField(abuseEntity.vcardArray, "tel") || dunno;
      if (abuseContactPhone.startsWith("tel:")) {
        abuseContactPhone = abuseContactPhone.substring(4);
      }
    }
  }
  // Override abuse info for Cloudflare if missing.
  if (
    (!abuseContactEmail || abuseContactEmail === dunno) &&
    registrarName === "Cloudflare, Inc."
  ) {
    abuseContactEmail = "registrar-abuse@cloudflare.com";
  }
  if (
    (!abuseContactPhone || abuseContactPhone === dunno) &&
    registrarName === "Cloudflare, Inc."
  ) {
    abuseContactPhone = "+1.4153197517";
  }
  // DNSSEC: if secureDNS.delegationSigned is available, use it.
  let dnssec = dunno;
  if (rdap.secureDNS && typeof rdap.secureDNS.delegationSigned === "boolean") {
    dnssec = rdap.secureDNS.delegationSigned ? "signed" : "unsigned";
  }
  return {
    domainName,
    domainStatus,
    creationDate,
    updatedDate,
    registrarRegistrationExpirationDate: expiryDate,
    registrarName,
    registrarIanaId,
    registrarUrl,
    registryDomainId,
    registrantName,
    registrantOrganization,
    registrantStreet,
    registrantCity,
    registrantCountry,
    registrantStateProvince,
    registrantPostalCode,
    abuseContactEmail,
    abuseContactPhone,
    dnssec,
  };
}

/**
 * Extracts a field’s value from a vCard array.
 */
function getVCardField(vcardArray: any, fieldName: string): string | undefined {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return undefined;
  const data = vcardArray[1];
  for (const entry of data) {
    if (entry[0].toLowerCase() === fieldName.toLowerCase()) {
      return entry[3];
    }
  }
  return undefined;
}

/* --------------------------- DNS LOOKUPS --------------------------- */
async function getIpAddress(domain: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${
    encodeURIComponent(domain)
  }&type=A`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.Answer
    ? data.Answer.filter((r: any) => r.type === 1).map((r: any) => r.data)
    : [];
}

async function getIpv6Address(domain: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${
    encodeURIComponent(domain)
  }&type=AAAA`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.Answer
    ? data.Answer.filter((r: any) => r.type === 28).map((r: any) => r.data)
    : [];
}

async function getNameServers(domain: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${
    encodeURIComponent(domain)
  }&type=NS`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.Answer
    ? data.Answer.filter((r: any) => r.type === 2).map((r: any) =>
      r.data.replace(/\.$/, "")
    )
    : [];
}

async function getMxRecords(domain: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${
    encodeURIComponent(domain)
  }&type=MX`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.Answer
    ? data.Answer.filter((r: any) => r.type === 15).map((r: any) => {
      const parts = r.data.split(" ");
      if (parts.length >= 2) {
        const priority = parts[0];
        const exchange = parts.slice(1).join(" ").replace(/\.$/, "");
        return `${exchange} (priority: ${priority})`;
      }
      return r.data;
    })
    : [];
}

async function getTxtRecords(domain: string): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${
    encodeURIComponent(domain)
  }&type=TXT`;
  const res = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.Answer
    ? data.Answer.filter((r: any) => r.type === 16).map((r: any) =>
      r.data.replace(/"/g, "")
    )
    : [];
}

/* --------------------------- SSL CERTIFICATE LOOKUP --------------------------- */
/**
 * Retrieves SSL certificate details via the SSL Labs API.
 * This call is made once; if no ready data is available, an empty object is returned.
 */
async function getSslCertificateDetails(domain: string): Promise<any> {
  try {
    const url = `https://api.ssllabs.com/api/v3/analyze?host=${
      encodeURIComponent(
        domain,
      )
    }&fromCache=on&all=done`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("SSL Labs fetch failed");
    const data = await res.json();
    if (
      data.status === "READY" &&
      data.endpoints &&
      data.endpoints.length > 0 &&
      data.endpoints[0].details &&
      data.certs
    ) {
      const cert = data.certs[0];
      return {
        issuer: cert.issuerSubject || "",
        valid_from: cert.notBefore || "",
        valid_to: cert.notAfter || "",
        subject: cert.subject || "",
        fingerprint: cert.fingerprint || "",
        key_size: cert.keySize || 0,
        signature_algorithm: cert.sigAlg || "",
      };
    }
    return {}; // If not ready, return an empty object.
  } catch (e) {
    console.error("SSL lookup error:", e);
    return {};
  }
}

/* --------------------------- HOST/GEOLCATION LOOKUP --------------------------- */
async function getHostData(ip: string): Promise<any> {
  try {
    const url = `https://ip-api.com/json/${
      encodeURIComponent(ip)
    }?fields=12249`;
    const res = await fetch(url);
    if (!res.ok) return {};
    return await res.json();
  } catch (e) {
    console.error("Host lookup error:", e);
    return {};
  }
}

/* --------------------------- MAIN HANDLER --------------------------- */
async function handler(req: Request): Promise<Response> {
  try {
    // Authorization
    // const authResult = await verifyAuth(req);
    // if (!authResult.success) {
    //   return new Response(JSON.stringify({ error: authResult.error }), {
    //     status: 401,
    //     headers: { "Content-Type": "application/json" },
    //   });
    // }
    // Parse query parameter
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain");
    if (!domain) {
      return new Response(
        JSON.stringify({ error: "Domain name is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const errors: string[] = [];

    // WHOIS/RDAP lookup
    const whoisRaw = await safeExecute(
      () => getWhoisData(domain),
      "WHOIS lookup failed",
      errors,
    );
    if (!whoisRaw) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch WHOIS data" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Normalize registrant (WHOIS) fields:
    // If missing, fill with "DATA REDACTED"
    const normalizedWhois = {
      name: whoisRaw.registrantName !== dunno
        ? whoisRaw.registrantName
        : "DATA REDACTED",
      organization: whoisRaw.registrantOrganization !== dunno
        ? whoisRaw.registrantOrganization
        : "DATA REDACTED",
      street: whoisRaw.registrantStreet !== dunno
        ? whoisRaw.registrantStreet
        : "DATA REDACTED",
      city: whoisRaw.registrantCity !== dunno
        ? whoisRaw.registrantCity
        : "DATA REDACTED",
      country: whoisRaw.registrantCountry !== dunno
        ? whoisRaw.registrantCountry
        : "DATA REDACTED",
      state: whoisRaw.registrantStateProvince !== dunno
        ? whoisRaw.registrantStateProvince
        : "DATA REDACTED",
      postal_code: whoisRaw.registrantPostalCode !== dunno
        ? whoisRaw.registrantPostalCode
        : "DATA REDACTED",
    };

    // DNS lookups (run concurrently)
    const [ipv4, ipv6, ns, mx, txt, ssl] = await Promise.all([
      safeExecute(() => getIpAddress(domain), "IPv4 lookup failed", errors),
      safeExecute(() => getIpv6Address(domain), "IPv6 lookup failed", errors),
      safeExecute(() => getNameServers(domain), "NS lookup failed", errors),
      safeExecute(() => getMxRecords(domain), "MX lookup failed", errors),
      safeExecute(() => getTxtRecords(domain), "TXT lookup failed", errors),
      safeExecute(
        () => getSslCertificateDetails(domain),
        "SSL lookup failed",
        errors,
      ),
    ]);

    // Host/geolocation lookup using the first IPv4 address (if available)
    let host = {};
    if (ipv4 && ipv4.length > 0) {
      host = (await safeExecute(
        () => getHostData(ipv4[0]),
        "Host lookup failed",
        errors,
      )) || {};
    }

    // Normalize registrar abuse info if missing
    let registrarUrl = whoisRaw.registrarUrl;
    if (
      whoisRaw.registrarName === "Cloudflare, Inc." &&
      (registrarUrl === dunno || !registrarUrl)
    ) {
      registrarUrl = "https://www.cloudflare.com";
    }
    let abuseEmail = whoisRaw.abuseContactEmail;
    let abusePhone = whoisRaw.abuseContactPhone;
    if (
      (!abuseEmail || abuseEmail === dunno) &&
      whoisRaw.registrarName === "Cloudflare, Inc."
    ) {
      abuseEmail = "registrar-abuse@cloudflare.com";
    }
    if (
      (!abusePhone || abusePhone === dunno) &&
      whoisRaw.registrarName === "Cloudflare, Inc."
    ) {
      abusePhone = "+1.4153197517";
    }

    // Construct final output, ensuring each section exists (or {} if missing)
    const domainInfo = {
      domainName: whoisRaw.domainName || dunno,
      status: Array.isArray(whoisRaw.domainStatus) ? whoisRaw.domainStatus : [],
      ip_addresses: {
        ipv4: ipv4 || [],
        ipv6: ipv6 || [],
      },
      dates: {
        expiry_date: whoisRaw.registrarRegistrationExpirationDate || "",
        updated_date: whoisRaw.updatedDate || "",
        creation_date: whoisRaw.creationDate || "",
      },
      registrar: {
        name: whoisRaw.registrarName || dunno,
        id: whoisRaw.registrarIanaId || dunno,
        url: registrarUrl || dunno,
        registryDomainId: whoisRaw.registryDomainId || dunno,
      },
      whois: normalizedWhois,
      abuse: {
        email: abuseEmail,
        phone: abusePhone,
      },
      dns: {
        dnssec: whoisRaw.dnssec && whoisRaw.dnssec !== dunno
          ? whoisRaw.dnssec
          : "unsigned",
        nameServers: ns || [],
        mxRecords: mx || [],
        txtRecords: txt || [],
      },
      ssl: ssl || {},
      host: host || {},
    };

    return new Response(
      JSON.stringify({
        domainInfo,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("Error processing domain information:", e);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/* --------------------------- EXPORT & RUN --------------------------- */
if (import.meta.main) {
  serve(handler);
}
export default handler;
