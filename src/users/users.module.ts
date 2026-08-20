import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BlocklistModule } from '../blocklist/blocklist.module';
import { PolicyModule } from '../policy/policy.module';
import { StorageModule } from '../storage/storage.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [StorageModule, AuditModule, PolicyModule, BlocklistModule],
  // ProfileController is registered before UsersController so its literal
  // "users/me/..." routes are matched before UsersController's "users/:id"
  // would otherwise treat "me" as an id — same ordering concern as the
  // "students" route inside UsersController itself.
  controllers: [ProfileController, UsersController],
  providers: [UsersService, ProfileService],
  exports: [UsersService],
})
export class UsersModule {}
