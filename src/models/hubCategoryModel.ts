import { Schema, model, Document, Types } from "mongoose";

// Categorías GLOBALES del Hub (transversales a todos sus negocios).
// No reemplazan las categorías propias de cada Business: un producto conserva
// sus categorías internas y ADEMÁS puede relacionarse con categorías globales
// del hub (products-service guarda esa relación en product.hubCategoryIds).
// Habilitan la búsqueda/navegación transversal del storefront del hub
// ("Pizza" → productos de N negocios).
const hubCategorySchema = new Schema({
    hub_id: { type: Schema.Types.ObjectId, ref: "hubs", required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String },
    image_url: { type: String },
    // Orden de despliegue en el storefront del hub
    sort_order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

hubCategorySchema.index({ hub_id: 1, slug: 1 }, { unique: true });
hubCategorySchema.index({ hub_id: 1, sort_order: 1 });

export interface IHubCategory extends Document {
    _id: Types.ObjectId;
    hub_id: Types.ObjectId;
    name: string;
    slug: string;
    description?: string;
    image_url?: string;
    sort_order: number;
    isActive: boolean;
    created_at: Date;
    updated_at: Date;
}

export default model<IHubCategory>("hub_categories", hubCategorySchema);
