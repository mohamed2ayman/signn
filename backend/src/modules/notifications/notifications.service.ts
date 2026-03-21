import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../../database/entities';
import { CreateNotificationDto } from './dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async findByUser(
    userId: string,
    filters?: { is_read?: boolean; limit?: number },
  ): Promise<Notification[]> {
    const qb = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId });

    if (filters?.is_read !== undefined) {
      qb.andWhere('notification.is_read = :isRead', { isRead: filters.is_read });
    }

    qb.orderBy('notification.created_at', 'DESC');

    if (filters?.limit) {
      qb.take(filters.limit);
    }

    return qb.getMany();
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationRepository.create({
      ...dto,
      type: dto.type || NotificationType.IN_APP,
    });

    const saved = await this.notificationRepository.save(notification);

    this.logger.log(`Notification created for user ${dto.user_id}: ${dto.title}`);

    return saved;
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    notification.is_read = true;
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { user_id: userId, is_read: false },
      { is_read: true },
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepository.count({
      where: { user_id: userId, is_read: false },
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id, user_id: userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.notificationRepository.remove(notification);
  }

  // Helper method to send notifications for various events
  async notifyContractStatusChange(
    userId: string,
    contractName: string,
    newStatus: string,
    contractId: string,
  ): Promise<Notification> {
    return this.create({
      user_id: userId,
      title: `Contract Status Updated`,
      message: `Contract "${contractName}" status changed to ${newStatus}`,
      type: NotificationType.BOTH,
      related_entity_type: 'contract',
      related_entity_id: contractId,
    });
  }

  async notifyRiskDetected(
    userId: string,
    contractName: string,
    riskLevel: string,
    contractId: string,
  ): Promise<Notification> {
    return this.create({
      user_id: userId,
      title: `Risk Detected: ${riskLevel}`,
      message: `A ${riskLevel} risk was detected in contract "${contractName}"`,
      type: NotificationType.BOTH,
      related_entity_type: 'contract',
      related_entity_id: contractId,
    });
  }

  async notifyObligationDue(
    userId: string,
    description: string,
    dueDate: Date,
    obligationId: string,
  ): Promise<Notification> {
    return this.create({
      user_id: userId,
      title: 'Obligation Due Soon',
      message: `Obligation "${description}" is due on ${dueDate.toISOString().split('T')[0]}`,
      type: NotificationType.BOTH,
      related_entity_type: 'obligation',
      related_entity_id: obligationId,
    });
  }
}
