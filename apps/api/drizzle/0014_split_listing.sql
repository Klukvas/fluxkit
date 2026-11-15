ALTER TABLE "product_type_option" ADD COLUMN "splits_listing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "search_index_state" ADD COLUMN "build_rebuild_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "product_type_one_split_option_idx" ON "product_type_option" USING btree ("product_type_id") WHERE "product_type_option"."splits_listing" = true;