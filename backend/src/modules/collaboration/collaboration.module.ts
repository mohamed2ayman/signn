import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CollaborationGateway } from './collaboration.gateway';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [CollaborationGateway],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
