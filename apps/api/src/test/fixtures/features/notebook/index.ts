import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  AdminController,
  FEATURE_DATABASE,
  LOCALE_CONFIG,
  MEDIA_PORT,
  ProblemException,
  RequirePermission,
  type FieldError,
  type LocaleConfig,
} from "@fluxkit/api-kit";
import {
  validateI18nText,
  type MediaPort,
  type MediaUploadDescription,
  type PersonalDataInventory,
} from "@fluxkit/core";
import { desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { fixtureNote } from "./schema.js";

/*
 * Test fixture only (ADR 0049): a feature with a table, written the way a real feature package is, against the API kit,
 * core and Drizzle only. Core specs load it from this folder (`FEATURES_ENABLED=notebook`) to prove every extension point
 * of a feature with tables: its migrations, the kit's permissions and problems, the database and media ports and its
 * personal-data inventory. Nothing outside apps/api/src/**\/*.spec.ts imports it.
 */

/** Every column of `fixture_note` is classified (no personal data), like a real feature's `personalDataInventory`. */
export const personalDataInventory: PersonalDataInventory = {
  fixture_note: Object.fromEntries(
    ["id", "title", "cover_upload_id", "created_at"].map((column) => [
      column,
      { class: "none", ref: "FIXTURE", export: "not_applicable", erasure: "not_applicable" },
    ]),
  ),
};

const createNoteSchema = z
  .object({
    title: z.unknown(),
    coverUploadId: z.uuid().optional(),
    /** Fixture switch: throw after the cover was attached, so a spec sees the rollback. */
    failAfterAttach: z.boolean().optional(),
  })
  .strict();

export interface NoteResponse {
  id: string;
  title: Record<string, string>;
  cover: MediaUploadDescription | null;
}

@Injectable()
class NotesService {
  constructor(
    @Inject(FEATURE_DATABASE) private readonly db: NodePgDatabase,
    @Inject(MEDIA_PORT) private readonly media: MediaPort,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  async create(body: unknown): Promise<NoteResponse> {
    const parsed = createNoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException({
        code: "validation_failed",
        detail: "The request is not valid.",
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: "invalid_value",
        })),
      });
    }
    const { title, coverUploadId, failAfterAttach } = parsed.data;
    const checked = validateI18nText(title, { ...this.locale, maxLength: 120, required: true });
    if (!checked.ok) {
      const errors: FieldError[] = checked.errors.map((error) => ({
        path: error.locale === undefined ? "title" : `title.${error.locale}`,
        code: error.reason,
      }));
      throw new ProblemException({ code: "validation_failed", detail: "Bad title.", errors });
    }
    const id = await this.db.transaction(async (tx) => {
      // Attach first: an unknown id then fails at its field (400), not on the foreign key of the insert (409).
      if (coverUploadId !== undefined) {
        await this.media.markAttachedByIds(tx, [{ path: "coverUploadId", id: coverUploadId }]);
      }
      const [row] = await tx
        .insert(fixtureNote)
        .values({ title: title as Record<string, string>, coverUploadId: coverUploadId ?? null })
        .returning({ id: fixtureNote.id });
      if (row === undefined) {
        throw new Error("The database returned no row for an insert that must return one.");
      }
      if (failAfterAttach === true) {
        throw new ProblemException({
          code: "rule_violation",
          detail: "The fixture was asked to fail after attaching.",
          extensions: { rule: "fixture_fail_after_attach" },
        });
      }
      return row.id;
    });
    return this.get(id);
  }

  async get(id: string): Promise<NoteResponse> {
    const [row] = await this.db.select().from(fixtureNote).where(eq(fixtureNote.id, id));
    if (row === undefined) {
      throw new ProblemException({ code: "not_found", detail: "Note was not found." });
    }
    const [cover] =
      row.coverUploadId === null ? [] : await this.media.describeUploads([row.coverUploadId]);
    return { id: row.id, title: row.title, cover: cover ?? null };
  }

  async list(): Promise<{ items: { id: string }[] }> {
    const rows = await this.db
      .select({ id: fixtureNote.id })
      .from(fixtureNote)
      .orderBy(desc(fixtureNote.createdAt));
    return { items: rows };
  }
}

/** Kit decorators: default `catalog.read` for GET, `catalog.write` for POST, `catalog.publish` where declared. */
@AdminController("notebook/notes")
class NotesAdminController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(): Promise<{ items: { id: string }[] }> {
    return this.notes.list();
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) id: string): Promise<NoteResponse> {
    return this.notes.get(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown): Promise<NoteResponse> {
    return this.notes.create(body);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @RequirePermission("catalog.publish")
  publish(@Param("id", new ParseUUIDPipe()) id: string): Promise<NoteResponse> {
    return this.notes.get(id);
  }
}

/** A route that declares nothing: the API's global guard must deny it (401 signed out, 403 signed in). */
@Controller("admin/notebook/undeclared")
class UndeclaredAdminController {
  @Get()
  leak(): { leaked: true } {
    return { leaked: true };
  }
}

@Module({
  controllers: [NotesAdminController, UndeclaredAdminController],
  providers: [NotesService],
})
class NotebookFeatureModule {}

export const featureModule = NotebookFeatureModule;
