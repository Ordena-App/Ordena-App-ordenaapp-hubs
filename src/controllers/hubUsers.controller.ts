import { Request, Response } from "express";
import bcrypt from "bcrypt";
import hubModel from "../models/hubModel";
import hubUserModel, { HubUserRole } from "../models/hubUserModel";
import { signHubToken } from "../utils/auth";
import { normalizeSlug, isValidSlug } from "../utils/slug";
import { assertBusinessBelongsToHub } from "../services/businessService.external";

const SALT_ROUNDS = 10;

/**
 * Onboarding self-serve: crea el Hub + su HUB_OWNER en una sola llamada.
 * POST /api/hub-users/register
 * Body: { hubName, slug?, country, currency, email, password, name? }
 *
 * El slug queda vivo al instante como {slug}.ordena.app (wildcard).
 */
export async function registerHubWithOwner(req: Request, res: Response): Promise<Response> {
    try {
        const { hubName, slug: rawSlug, country, currency, email, password, name, timezone, language } = req.body || {};

        if (!hubName || !country || !currency || !email || !password) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "hubName, country, currency, email y password son requeridos",
                data: {},
            });
        }

        const slug = normalizeSlug(rawSlug || hubName);
        if (!isValidSlug(slug)) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "Slug inválido o reservado. Usa 3-40 caracteres (letras, números y guiones).",
                data: { slug },
            });
        }

        const [slugTaken, emailTaken] = await Promise.all([
            hubModel.exists({ slug }),
            hubUserModel.exists({ email: String(email).toLowerCase().trim() }),
        ]);
        if (slugTaken) {
            return res.status(409).json({
                status: false,
                statusCode: 409,
                message: "Ese nombre de hub ya está en uso. Elige otro.",
                data: { slug },
            });
        }
        if (emailTaken) {
            return res.status(409).json({
                status: false,
                statusCode: 409,
                message: "Ya existe un usuario con ese email.",
                data: {},
            });
        }

        const hub = await hubModel.create({
            name: hubName,
            slug,
            country,
            currency,
            ...(timezone ? { timezone } : {}),
            ...(language ? { language } : {}),
            contact: { email },
        });

        const hashed = await bcrypt.hash(String(password), SALT_ROUNDS);
        const owner = await hubUserModel.create({
            hub_id: hub._id,
            name: name || hubName,
            email,
            password: hashed,
            role: "HUB_OWNER",
        });

        const token = signHubToken({
            userId: String(owner._id),
            email: owner.email,
            hubId: String(hub._id),
            role: owner.role,
            businessId: null,
        });

        const safeUser = { _id: owner._id, name: owner.name, email: owner.email, role: owner.role };
        return res.status(201).json({
            status: true,
            statusCode: 201,
            message: "Hub creado correctamente",
            data: { hub, user: safeUser, token },
        });
    } catch (error) {
        console.error("Error en registro de hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/**
 * POST /api/hub-users/login
 * Body: { email, password }
 * Funciona para TODOS los roles, incluido BUSINESS_VIEWER (Portal Business):
 * el token estampa hubId + role + businessId (si aplica).
 */
export async function loginHubUser(req: Request, res: Response): Promise<Response> {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "email y password son requeridos",
                data: {},
            });
        }

        const user = await hubUserModel.findOne({ email: String(email).toLowerCase().trim() });
        if (!user || user.status !== "ACTIVE") {
            return res.status(401).json({
                status: false,
                statusCode: 401,
                message: "Credenciales inválidas",
                data: {},
            });
        }

        const ok = await bcrypt.compare(String(password), user.password);
        if (!ok) {
            return res.status(401).json({
                status: false,
                statusCode: 401,
                message: "Credenciales inválidas",
                data: {},
            });
        }

        // El Portal Business solo necesita identidad y branding: sin proyección,
        // el snapshot del login le entregaba suscripción, límites, métricas y el
        // WhatsApp del repartidor, y encima se cachea en su localStorage.
        const hubQuery = hubModel.findById(user.hub_id);
        const hub =
            user.role === "BUSINESS_VIEWER"
                ? await hubQuery.select("name slug logo favicon branding timezone country currency language status")
                : await hubQuery;
        if (!hub || hub.status !== "ACTIVE") {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "El hub no está activo",
                data: {},
            });
        }

        const token = signHubToken({
            userId: String(user._id),
            email: user.email,
            hubId: String(user.hub_id),
            role: user.role,
            businessId: user.business_id || null,
        });

        const safeUser = {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            business_id: user.business_id || null,
        };
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Sesión iniciada correctamente",
            data: { user: safeUser, hub, token },
        });
    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/**
 * POST /api/hub-users  (HUB_OWNER/HUB_ADMIN)
 * Crea usuarios del hub. Para BUSINESS_VIEWER, businessId es obligatorio —
 * es el candado del Portal Business.
 */
export async function createHubUser(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const { email, password, name, role, businessId } = req.body || {};

        const hubForLock: any = await hubModel.findById(ctx.hubId).select("subscription.pastDueSince").lean();
        // Mora >= 15 días: se bloquea SOLO crear (negocios/usuarios) — la
        // operación pública y todo lo demás siguen intactos (decisión F3 v2).
        const pastDueSince = hubForLock?.subscription?.pastDueSince;
        if (pastDueSince && Date.now() - new Date(pastDueSince).getTime() > 15 * 24 * 60 * 60 * 1000) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "Tu suscripción lleva más de 15 días con un pago pendiente. Actualiza tu método de pago en Plan para seguir creando.",
                data: { reason: "past_due_lock" },
            });
        }

        const allowedRoles: HubUserRole[] = ["HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"];
        if (!email || !password || !role || !allowedRoles.includes(role)) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "email, password y role (HUB_ADMIN | HUB_STAFF | BUSINESS_VIEWER) son requeridos",
                data: {},
            });
        }
        if (role === "BUSINESS_VIEWER" && !businessId) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "businessId es requerido para el rol BUSINESS_VIEWER",
                data: {},
            });
        }
        // El acceso de portal solo puede apuntar a un negocio de ESTE hub.
        // (Sin esto, un businessId ajeno crearia un login roto: el scope del
        // token impide fugas, pero el viewer no veria nada.)
        if (role === "BUSINESS_VIEWER") {
            try {
                await assertBusinessBelongsToHub(ctx.hubId, String(businessId));
            } catch {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "El negocio indicado no pertenece a este hub",
                    data: {},
                });
            }
        }

        const emailTaken = await hubUserModel.exists({ email: String(email).toLowerCase().trim() });
        if (emailTaken) {
            return res.status(409).json({
                status: false,
                statusCode: 409,
                message: "Ya existe un usuario con ese email.",
                data: {},
            });
        }

        const hashed = await bcrypt.hash(String(password), SALT_ROUNDS);
        const user = await hubUserModel.create({
            hub_id: ctx.hubId,
            name,
            email,
            password: hashed,
            role,
            business_id: role === "BUSINESS_VIEWER" ? String(businessId) : null,
        });

        const safeUser = { _id: user._id, name: user.name, email: user.email, role: user.role, business_id: user.business_id };
        return res.status(201).json({
            status: true,
            statusCode: 201,
            message: "Usuario creado correctamente",
            data: { user: safeUser },
        });
    } catch (error) {
        console.error("Error creando usuario de hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/** GET /api/hub-users  (HUB_OWNER/HUB_ADMIN) — usuarios del hub, sin hashes. */
export async function getHubUsers(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const users = await hubUserModel
            .find({ hub_id: ctx.hubId })
            .select("-password -password_reset_token_hash -password_reset_expires_at")
            .sort({ created_at: -1 });
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Usuarios del hub",
            data: { users },
        });
    } catch (error) {
        console.error("Error listando usuarios de hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/** DELETE /api/hub-users/:id  (HUB_OWNER/HUB_ADMIN) — nunca al último OWNER. */
export async function deleteHubUser(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const { id } = req.params;

        const user = await hubUserModel.findOne({ _id: id, hub_id: ctx.hubId });
        if (!user) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Usuario no encontrado",
                data: {},
            });
        }
        if (user.role === "HUB_OWNER") {
            const owners = await hubUserModel.countDocuments({ hub_id: ctx.hubId, role: "HUB_OWNER" });
            if (owners <= 1) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "No puedes eliminar al último propietario del hub",
                    data: {},
                });
            }
        }

        await hubUserModel.deleteOne({ _id: id, hub_id: ctx.hubId });
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Usuario eliminado",
            data: {},
        });
    } catch (error) {
        console.error("Error eliminando usuario de hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}
