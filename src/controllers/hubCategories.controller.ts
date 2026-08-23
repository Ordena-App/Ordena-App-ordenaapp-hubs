import { Request, Response } from "express";
import hubCategoryModel from "../models/hubCategoryModel";
import { normalizeSlug } from "../utils/slug";

/** GET /api/hubs/me/categories — todas (activas e inactivas) para administración. */
export async function getMyHubCategories(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const categories = await hubCategoryModel
            .find({ hub_id: ctx.hubId })
            .sort({ sort_order: 1, name: 1 });
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Categorías del hub",
            data: { categories },
        });
    } catch (error) {
        console.error("Error listando categorías:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/** POST /api/hubs/me/categories  (HUB_OWNER/HUB_ADMIN) */
export async function createHubCategory(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const { name, description, image_url, sort_order } = req.body || {};
        if (!name) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "name es requerido",
                data: {},
            });
        }
        const slug = normalizeSlug(name);
        const exists = await hubCategoryModel.exists({ hub_id: ctx.hubId, slug });
        if (exists) {
            return res.status(409).json({
                status: false,
                statusCode: 409,
                message: "Ya existe una categoría con ese nombre",
                data: { slug },
            });
        }
        const category = await hubCategoryModel.create({
            hub_id: ctx.hubId,
            name,
            slug,
            description,
            image_url,
            sort_order: typeof sort_order === "number" ? sort_order : 0,
        });
        return res.status(201).json({
            status: true,
            statusCode: 201,
            message: "Categoría creada",
            data: { category },
        });
    } catch (error) {
        console.error("Error creando categoría:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/** PUT /api/hubs/me/categories/:id  (HUB_OWNER/HUB_ADMIN) */
export async function updateHubCategory(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const { id } = req.params;
        const { name, description, image_url, sort_order, isActive } = req.body || {};

        const patch: Record<string, unknown> = { updated_at: new Date() };
        if (name !== undefined) {
            patch["name"] = name;
            patch["slug"] = normalizeSlug(String(name));
        }
        if (description !== undefined) patch["description"] = description;
        if (image_url !== undefined) patch["image_url"] = image_url;
        if (typeof sort_order === "number") patch["sort_order"] = sort_order;
        if (typeof isActive === "boolean") patch["isActive"] = isActive;

        const category = await hubCategoryModel.findOneAndUpdate(
            { _id: id, hub_id: ctx.hubId },
            { $set: patch },
            { new: true }
        );
        if (!category) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Categoría no encontrada",
                data: {},
            });
        }
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Categoría actualizada",
            data: { category },
        });
    } catch (error) {
        console.error("Error actualizando categoría:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/** DELETE /api/hubs/me/categories/:id  (HUB_OWNER/HUB_ADMIN) */
export async function deleteHubCategory(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const { id } = req.params;
        const result = await hubCategoryModel.deleteOne({ _id: id, hub_id: ctx.hubId });
        if (result.deletedCount === 0) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Categoría no encontrada",
                data: {},
            });
        }
        // Nota: products-service mantiene product.hubCategoryIds; la limpieza de
        // referencias colgantes se resuelve allá (las IDs inexistentes simplemente
        // no matchean en las búsquedas del storefront).
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Categoría eliminada",
            data: {},
        });
    } catch (error) {
        console.error("Error eliminando categoría:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}
