import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/config";
import { HubUserRole } from "../models/hubUserModel";

export interface HubContext {
    userId: string;
    email: string;
    hubId: string;
    role: HubUserRole;
    // Solo presente para BUSINESS_VIEWER: el ÚNICO negocio que puede consultar.
    businessId?: string | null;
}

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            hubContext?: HubContext;
        }
    }
}

function extractId(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && "_id" in (value as any)) {
        return String((value as any)._id);
    }
    return String(value);
}

export function signHubToken(payload: HubContext): string {
    return jwt.sign(
        {
            userId: payload.userId,
            email: payload.email,
            hubId: payload.hubId,
            role: payload.role,
            businessId: payload.businessId ?? null,
        },
        JWT_SECRET,
        { expiresIn: "7d" }
    );
}

export function verifyHubJWT(req: Request, res: Response, next: NextFunction): any {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            status: false,
            statusCode: 401,
            message: "Token de autorización requerido",
            data: {},
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as {
            userId?: unknown;
            email: string;
            hubId?: unknown;
            role: HubUserRole;
            businessId?: unknown;
        };

        const hubIdStr = extractId(decoded.hubId);
        if (!hubIdStr) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "Usuario no asociado a ningún hub",
                data: {},
            });
        }

        req.hubContext = {
            userId: extractId(decoded.userId) || "",
            email: decoded.email,
            hubId: hubIdStr,
            role: decoded.role,
            businessId: extractId(decoded.businessId),
        };
        return next();
    } catch (error) {
        return res.status(401).json({
            status: false,
            statusCode: 401,
            message: "Token inválido o expirado",
            data: {},
        });
    }
}

// Restringe el endpoint a los roles indicados.
export function requireHubRole(...roles: HubUserRole[]) {
    return (req: Request, res: Response, next: NextFunction): any => {
        const ctx = req.hubContext;
        if (!ctx || !roles.includes(ctx.role)) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "No tienes permisos para esta acción",
                data: {},
            });
        }
        return next();
    };
}

/**
 * Regla de aislamiento del Portal Business: un BUSINESS_VIEWER solo puede
 * operar sobre SU businessId (el del token). Para los roles de hub devuelve
 * el businessId solicitado tal cual (la pertenencia hub↔business se valida
 * en el controller contra business-service).
 *
 * Retorna null si el viewer intenta acceder a un negocio ajeno — el caller
 * debe responder 403 sin filtrar información.
 */
export function resolveScopedBusinessId(ctx: HubContext, requestedBusinessId?: string): string | null {
    if (ctx.role === "BUSINESS_VIEWER") {
        if (!ctx.businessId) return null;
        if (requestedBusinessId && requestedBusinessId !== ctx.businessId) return null;
        return ctx.businessId;
    }
    return requestedBusinessId || null;
}
