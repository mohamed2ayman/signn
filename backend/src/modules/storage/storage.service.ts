import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface StorageResult {
  file_url: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadDir: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = this.configService.get<string>(
      'UPLOAD_DIR',
      path.join(process.cwd(), 'uploads'),
    );
    this.baseUrl = this.configService.get<string>(
      'BASE_URL',
      'http://localhost:3000',
    );
    this.ensureUploadDirExists();
  }

  private ensureUploadDirExists(): void {
    const dirs = ['documents', 'knowledge-assets', 'contracts', 'policies', 'temp'];
    for (const dir of dirs) {
      const fullPath = path.join(this.uploadDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  async uploadFile(
    file: UploadedFile,
    folder: string = 'documents',
  ): Promise<StorageResult> {
    const ext = path.extname(file.originalname);
    const fileName = `${uuidv4()}${ext}`;
    const filePath = path.join(this.uploadDir, folder, fileName);

    await fs.promises.writeFile(filePath, file.buffer);

    this.logger.log(`File uploaded: ${filePath} (${file.size} bytes)`);

    return {
      file_url: `${this.baseUrl}/uploads/${folder}/${fileName}`,
      file_name: file.originalname,
      file_size: file.size,
      mime_type: file.mimetype,
    };
  }

  async deleteFile(fileUrl: string): Promise<void> {
    try {
      const relativePath = fileUrl.replace(`${this.baseUrl}/uploads/`, '');
      const filePath = path.join(this.uploadDir, relativePath);

      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger.log(`File deleted: ${filePath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error.message}`);
    }
  }

  async getFileBuffer(fileUrl: string): Promise<Buffer> {
    const relativePath = fileUrl.replace(`${this.baseUrl}/uploads/`, '');
    const filePath = path.join(this.uploadDir, relativePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return fs.promises.readFile(filePath);
  }

  getFilePath(fileUrl: string): string {
    const relativePath = fileUrl.replace(`${this.baseUrl}/uploads/`, '');
    return path.join(this.uploadDir, relativePath);
  }

  async extractTextFromFile(fileUrl: string): Promise<string> {
    const buffer = await this.getFileBuffer(fileUrl);
    const ext = path.extname(fileUrl).toLowerCase();

    // Basic text extraction - for PDF/DOCX, AI backend handles OCR
    if (ext === '.txt') {
      return buffer.toString('utf-8');
    }

    // For other file types, return empty - AI backend will handle extraction
    return '';
  }
}
