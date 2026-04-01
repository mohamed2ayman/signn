import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  user: {
    id: string;
    email: string;
    role: string;
    organization_id: string;
  };
}

interface RoomUser {
  id: string;
  email: string;
  name?: string;
  joinedAt: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/collaboration',
})
export class CollaborationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CollaborationGateway.name);

  /** contractId → Map<socketId, RoomUser> */
  private rooms = new Map<string, Map<string, RoomUser>>();

  constructor(private readonly configService: ConfigService) {}

  // ─── Connection Lifecycle ───────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client ${client.id} rejected: no token`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = jwt.verify(token, secret!) as any;

      (client as AuthenticatedSocket).user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        organization_id: payload.organization_id,
      };

      this.logger.log(
        `Client connected: ${client.id} (user: ${payload.email})`,
      );
    } catch (err) {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = (client as AuthenticatedSocket).user;
    if (!user) return;

    // Remove from all rooms
    for (const [contractId, members] of this.rooms.entries()) {
      if (members.has(client.id)) {
        members.delete(client.id);

        // Notify remaining room members
        const usersList = Array.from(members.values());
        this.server
          .to(`contract:${contractId}`)
          .emit('user:left', { userId: user.id, email: user.email });
        this.server
          .to(`contract:${contractId}`)
          .emit('room:users', usersList);

        if (members.size === 0) {
          this.rooms.delete(contractId);
        }
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ─── Room Management ────────────────────────────────────────

  @SubscribeMessage('join:contract')
  handleJoinContract(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string; name?: string },
  ) {
    const user = (client as AuthenticatedSocket).user;
    if (!user) return;

    const roomKey = `contract:${data.contractId}`;

    // Leave any previous contract rooms
    for (const [contractId, members] of this.rooms.entries()) {
      if (members.has(client.id)) {
        members.delete(client.id);
        client.leave(`contract:${contractId}`);
        const usersList = Array.from(members.values());
        this.server
          .to(`contract:${contractId}`)
          .emit('user:left', { userId: user.id, email: user.email });
        this.server
          .to(`contract:${contractId}`)
          .emit('room:users', usersList);
        if (members.size === 0) this.rooms.delete(contractId);
      }
    }

    // Join the new room
    client.join(roomKey);

    if (!this.rooms.has(data.contractId)) {
      this.rooms.set(data.contractId, new Map());
    }

    const roomUser: RoomUser = {
      id: user.id,
      email: user.email,
      name: data.name,
      joinedAt: new Date().toISOString(),
    };

    this.rooms.get(data.contractId)!.set(client.id, roomUser);

    // Broadcast to room
    const usersList = Array.from(
      this.rooms.get(data.contractId)!.values(),
    );
    this.server.to(roomKey).emit('user:joined', {
      userId: user.id,
      email: user.email,
      name: data.name,
    });
    this.server.to(roomKey).emit('room:users', usersList);

    this.logger.log(
      `User ${user.email} joined room contract:${data.contractId} (${usersList.length} users)`,
    );
  }

  @SubscribeMessage('leave:contract')
  handleLeaveContract(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string },
  ) {
    const user = (client as AuthenticatedSocket).user;
    if (!user) return;

    const members = this.rooms.get(data.contractId);
    if (members) {
      members.delete(client.id);
      client.leave(`contract:${data.contractId}`);

      const usersList = Array.from(members.values());
      this.server
        .to(`contract:${data.contractId}`)
        .emit('user:left', { userId: user.id, email: user.email });
      this.server
        .to(`contract:${data.contractId}`)
        .emit('room:users', usersList);

      if (members.size === 0) this.rooms.delete(data.contractId);
    }
  }

  // ─── Event Emitters (called by services) ────────────────────

  emitClauseUpdated(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('clause:updated', payload);
  }

  emitClauseAdded(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('clause:added', payload);
  }

  emitClauseRemoved(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('clause:removed', payload);
  }

  emitCommentAdded(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('comment:added', payload);
  }

  emitCommentResolved(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('comment:resolved', payload);
  }

  emitStatusChanged(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('status:changed', payload);
  }

  emitRiskUpdated(contractId: string, payload: any) {
    this.server
      .to(`contract:${contractId}`)
      .emit('risk:updated', payload);
  }
}
