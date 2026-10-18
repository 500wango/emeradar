import { transaction } from '@emeradar/db';
import { EmeradarError, ErrorCode } from '@emeradar/core';
import { query } from '@emeradar/db';

export type ProjectOutcomeStatus =
  | 'BUILDING'
  | 'LAUNCHED'
  | 'ABANDONED'
  | 'NO_TRACTION'
  | 'EARLY_TRACTION'
  | 'TRACTION';

export interface ProjectOutcomeCheckin {
  id: string;
  status: ProjectOutcomeStatus;
  note: string | null;
  createdAt: string;
}

export interface ProjectOutcomeState {
  checkins: ProjectOutcomeCheckin[];
  nextCheckin: {
    horizonDays: 30 | 60 | 90;
    dueDate: string;
    overdue: boolean;
  } | null;
}

const HORIZONS = [30, 60, 90] as const;

export class ProjectOutcomeService {
  static async getState(projectId: string, userId: string): Promise<ProjectOutcomeState> {
    const projectRes = await query<{
      created_at: string;
      launch_date: string | null;
    }>(
      `SELECT created_at::text, launch_date::text FROM projects WHERE id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    const project = projectRes.rows[0];
    if (!project) throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);

    const checkinsRes = await query<any>(
      `SELECT id::text, status, note, created_at::text
         FROM project_outcome_checkins
        WHERE project_id = $1
        ORDER BY created_at DESC`,
      [projectId]
    );
    const checkins: ProjectOutcomeCheckin[] = checkinsRes.rows.map((row) => ({
      id: row.id,
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
    }));

    // 回访从上线日算；还没上线时从项目创建日算，避免永远没有第一次回访。
    const base = new Date(project.launch_date || project.created_at);
    const now = Date.now();
    let next: ProjectOutcomeState['nextCheckin'] = null;
    for (const horizon of HORIZONS) {
      const due = new Date(base);
      due.setDate(due.getDate() + horizon);
      if (due.getTime() > now) continue;
      // 该 horizon 之后已有一次回访，就算完成。
      const done = checkins.some((c) => new Date(c.createdAt).getTime() >= due.getTime());
      if (!done) {
        next = {
          horizonDays: horizon,
          dueDate: due.toISOString().slice(0, 10),
          overdue: true,
        };
        break;
      }
    }

    return { checkins, nextCheckin: next };
  }

  static async record(
    projectId: string,
    userId: string,
    status: ProjectOutcomeStatus,
    note?: string | null
  ): Promise<ProjectOutcomeCheckin> {
    return transaction(async (client) => {
      const owned = await client.query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [projectId, userId]
      );
      if (owned.rows.length === 0) {
        throw new EmeradarError(ErrorCode.NOT_FOUND, `Project not found: ${projectId}`, 404);
      }

      const inserted = await client.query<any>(
        `INSERT INTO project_outcome_checkins (project_id, user_id, status, note)
         VALUES ($1, $2, $3, $4)
         RETURNING id::text, status, note, created_at::text`,
        [projectId, userId, status, note?.trim() || null]
      );

      // 同步项目的当前状态；历史仍在 checkins 表里。
      const projectStatus =
        status === 'LAUNCHED' ? 'LAUNCHED' : status === 'ABANDONED' ? 'ARCHIVED' : null;
      const outcomeStatus =
        status === 'ABANDONED' || status === 'NO_TRACTION'
          ? 'NO_TRACTION'
          : status === 'EARLY_TRACTION'
          ? 'EARLY_TRACTION'
          : status === 'TRACTION'
          ? 'TRACTION'
          : 'UNKNOWN';
      await client.query(
        `UPDATE projects
            SET status = COALESCE($2, status),
                outcome_status = $3,
                launch_date = CASE WHEN $2 = 'LAUNCHED' AND launch_date IS NULL THEN CURRENT_DATE ELSE launch_date END,
                updated_at = NOW()
          WHERE id = $1`,
        [projectId, projectStatus, outcomeStatus]
      );

      const row = inserted.rows[0];
      return { id: row.id, status: row.status, note: row.note, createdAt: row.created_at };
    });
  }
}
