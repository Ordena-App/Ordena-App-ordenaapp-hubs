// Normalización y validación de slugs públicos ({slug}.ordena.app).

// Subdominios/nombres que jamás pueden ser un hub. Incluye los hosts core de
// la plataforma y palabras operativas.
export const RESERVED_SLUGS = new Set([
    "www", "app", "api", "admin", "market", "staging", "dev", "test",
    "login", "auth", "dashboard", "checkout", "pagos", "payments",
    "ordena", "ordenaapp", "hub", "hubs", "agency", "agencies",
    "mail", "smtp", "ftp", "cdn", "static", "assets", "docs", "blog",
    "status", "support", "help", "ayuda",
]);

export function normalizeSlug(raw: string): string {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // sin acentos
        .replace(/[^a-z0-9-\s]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

// 3-40 chars, alfanumérico y guiones, sin guión inicial/final.
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export function isValidSlug(slug: string): boolean {
    if (!SLUG_REGEX.test(slug)) return false;
    if (RESERVED_SLUGS.has(slug)) return false;
    return true;
}
