import { Module } from '@nestjs/common';
import { DevMailboxController } from './dev-mailbox.controller';

@Module({ controllers: [DevMailboxController] })
export class DevModule {}
