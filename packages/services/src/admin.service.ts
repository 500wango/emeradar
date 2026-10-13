import { AdminPipelineService } from './admin/pipeline';
import { AdminCandidateService } from './admin/candidates';
import { AdminSourceService } from './admin/sources';
import { AdminUserService } from './admin/users';
export type { AdminUserListItem, AdminUserStats, AdminPipelineOverview, AdminCandidateItem, AdminSourceItem } from './admin/types';

/** Compatibility facade; each domain owns its implementation and dependencies. */
export class AdminService {
  static getPipelineOverview(...args: Parameters<typeof AdminPipelineService.getPipelineOverview>) {
    return AdminPipelineService.getPipelineOverview(...args);
  }
  static triggerTask(...args: Parameters<typeof AdminPipelineService.triggerTask>) {
    return AdminPipelineService.triggerTask(...args);
  }
  static listCandidates(...args: Parameters<typeof AdminCandidateService.listCandidates>) {
    return AdminCandidateService.listCandidates(...args);
  }
  static moderateCandidate(...args: Parameters<typeof AdminCandidateService.moderateCandidate>) {
    return AdminCandidateService.moderateCandidate(...args);
  }
  static listSources(...args: Parameters<typeof AdminSourceService.listSources>) {
    return AdminSourceService.listSources(...args);
  }
  static addRssSource(...args: Parameters<typeof AdminSourceService.addRssSource>) {
    return AdminSourceService.addRssSource(...args);
  }
  static toggleSource(...args: Parameters<typeof AdminSourceService.toggleSource>) {
    return AdminSourceService.toggleSource(...args);
  }
  static getUserStats(...args: Parameters<typeof AdminUserService.getUserStats>) {
    return AdminUserService.getUserStats(...args);
  }
  static listUsers(...args: Parameters<typeof AdminUserService.listUsers>) {
    return AdminUserService.listUsers(...args);
  }
  static getUserById(...args: Parameters<typeof AdminUserService.getUserById>) {
    return AdminUserService.getUserById(...args);
  }
  static updateUser(...args: Parameters<typeof AdminUserService.updateUser>) {
    return AdminUserService.updateUser(...args);
  }
  static resetUserPassword(...args: Parameters<typeof AdminUserService.resetUserPassword>) {
    return AdminUserService.resetUserPassword(...args);
  }
  static createUserByAdmin(...args: Parameters<typeof AdminUserService.createUserByAdmin>) {
    return AdminUserService.createUserByAdmin(...args);
  }
}
