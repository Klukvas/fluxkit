import { Body, Get, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiProduces, ApiResponse } from "@nestjs/swagger";
import type { Response } from "express";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { AdminController } from "../../auth/admin-controller.decorator.js";
import { CurrentAdmin } from "../../auth/current-admin.js";
import { ApiProblemResponses, ApiZodBody, ApiZodResponse } from "../../common/openapi.js";
import { uuidParam, ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { adminShipmentSchema } from "../../orders/orders.schemas.js";
import {
  createShipmentResultSchema,
  createShipmentSchema,
  shipmentListSchema,
  type CreateShipmentBody,
  type CreateShipmentResult,
  type ShipmentList,
} from "./shipments.schemas.js";
import type { AdminShipmentView } from "./shipment-view.js";
import { ShipmentsService } from "./shipments.service.js";

const ID_PARAM = { name: "id", format: "uuid", description: "Order id." };
const SHIPMENT_PARAM = { name: "shipmentId", format: "uuid", description: "Shipment id." };

/**
 * The fixed headers of a label answer; `shipments.spec.ts` pins every one. The PDF is a download (never rendered on our
 * origin), never cached, never sniffed, and sandboxed should a browser render it anyway.
 */
export const LABEL_HEADERS = Object.freeze({
  "Content-Type": "application/pdf",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
});

/**
 * Thin HTTP layer of the shipments of an order (ADR 0029 decision 10). The order permissions, not `shipping.manage`:
 * GET (the list, the label) needs `orders.read`, every POST `orders.write`; the viewer holds neither. The acting admin
 * is read from the session and recorded in the shipment journal. A carrier write is never retried here or by the client:
 * an `unknown` shipment is settled with `reconcile`.
 */
@AdminController("orders", { read: "orders.read", write: "orders.write" })
export class ShipmentsController {
  constructor(@Inject(ShipmentsService) private readonly shipments: ShipmentsService) {}

  @Get(":id/shipments")
  @ApiOperation({
    summary: "List the shipments of an order",
    description: "Every carrier waybill of the order, oldest first, with its status journal.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodResponse(200, shipmentListSchema, "The shipments.")
  @ApiProblemResponses(400, 404)
  list(@Param("id", uuidParam("id")) id: string): Promise<ShipmentList> {
    return this.shipments.list(id);
  }

  @Post(":id/shipments")
  @HttpCode(201)
  @ApiOperation({
    summary: "Create the carrier waybill of a paid order",
    description:
      "Only for a `paid` order with no line awaiting stock, a shipping method with a carrier and no active shipment. The shipment is stored as `pending` before the carrier is asked (15 s limit), then answered as `created`, `failed` (with `failure`) or `unknown` (the answer was lost: whether a waybill exists is not known; never create again, call `POST .../reconcile`). The order status does not change. The recipient's name and phone are taken from the order and sent to the carrier only.",
  })
  @ApiParam(ID_PARAM)
  @ApiZodBody(createShipmentSchema)
  @ApiZodResponse(201, createShipmentResultSchema, "The shipment as the carrier left it.")
  @ApiProblemResponses(400, 404, 409)
  create(
    @Param("id", uuidParam("id")) id: string,
    @Body(new ZodValidationPipe(createShipmentSchema)) body: CreateShipmentBody,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CreateShipmentResult> {
    return this.shipments.create(id, admin.userId, body);
  }

  @Post(":id/shipments/:shipmentId/reconcile")
  @HttpCode(200)
  @ApiOperation({
    summary: "Settle an unknown shipment with the carrier",
    description:
      "Asks the carrier for the waybill created with our order number within an instant window (the shipment's creation minus 5 minutes to now plus 5 minutes): found makes the shipment `created`, none makes it `failed` (then a new create is allowed) once the shipment is at least 5 minutes old; a younger one stays as it is and answers 409 `reconcile_too_early` with `Retry-After`. For an `unknown` shipment, or a `pending` one older than 2 minutes (left by a crash). A carrier failure changes nothing (503 `shipping_provider_unavailable` or 409 `carrier_*`).",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(SHIPMENT_PARAM)
  @ApiZodResponse(200, adminShipmentSchema, "The settled shipment.")
  @ApiProblemResponses(400, 404, 409, 503)
  reconcile(
    @Param("id", uuidParam("id")) id: string,
    @Param("shipmentId", uuidParam("shipmentId")) shipmentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminShipmentView> {
    return this.shipments.reconcile(id, shipmentId, admin.userId);
  }

  @Post(":id/shipments/:shipmentId/cancel")
  @HttpCode(200)
  @ApiOperation({
    summary: "Cancel a created waybill at the carrier",
    description:
      "Only a `created` shipment (the carrier allows it until the parcel is handed over). Never touches the order or its stock. A carrier failure changes nothing.",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(SHIPMENT_PARAM)
  @ApiZodResponse(200, adminShipmentSchema, "The cancelled shipment.")
  @ApiProblemResponses(400, 404, 409, 503)
  cancel(
    @Param("id", uuidParam("id")) id: string,
    @Param("shipmentId", uuidParam("shipmentId")) shipmentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminShipmentView> {
    return this.shipments.cancel(id, shipmentId, admin.userId);
  }

  @Post(":id/shipments/:shipmentId/refresh")
  @HttpCode(200)
  @ApiOperation({
    summary: "Ask the carrier for the current status of one shipment",
    description:
      "What the tracking job does, now, for one shipment with a waybill that is still on its way; a new status is journalled with this admin as the actor. A carrier failure changes nothing.",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(SHIPMENT_PARAM)
  @ApiZodResponse(200, adminShipmentSchema, "The shipment.")
  @ApiProblemResponses(400, 404, 409, 503)
  refresh(
    @Param("id", uuidParam("id")) id: string,
    @Param("shipmentId", uuidParam("shipmentId")) shipmentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminShipmentView> {
    return this.shipments.refresh(id, shipmentId, admin.userId);
  }

  @Get(":id/shipments/:shipmentId/label")
  @ApiOperation({
    summary: "Download the printable label of a waybill (PDF)",
    description:
      "Fetched from the carrier by the API and passed on as a download (`Content-Disposition: attachment`, `no-store`, `nosniff`, at most 10 MiB, checked to be a PDF); a carrier label URL never reaches the browser. 503 when the carrier cannot be reached or answers anything but a PDF.",
  })
  @ApiParam(ID_PARAM)
  @ApiParam(SHIPMENT_PARAM)
  @ApiProduces("application/pdf")
  @ApiResponse({
    status: 200,
    description: "The label.",
    content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
  })
  @ApiProblemResponses(400, 404, 409, 503)
  async label(
    @Param("id", uuidParam("id")) id: string,
    @Param("shipmentId", uuidParam("shipmentId")) shipmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const label = await this.shipments.label(id, shipmentId);
    for (const [name, value] of Object.entries(LABEL_HEADERS)) {
      response.setHeader(name, value);
    }
    response.setHeader("Content-Disposition", `attachment; filename="${label.filename}"`);
    response.setHeader("Content-Length", String(label.bytes.length));
    response
      .status(200)
      .end(Buffer.from(label.bytes.buffer, label.bytes.byteOffset, label.bytes.length));
  }
}
