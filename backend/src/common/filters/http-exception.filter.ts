import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'INTERNAL_ERROR';

    if (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE') {
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'File too large';
      error = 'PAYLOAD_TOO_LARGE';
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || message;
        error = (resp.error as string) || error;
      }
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
    });
  }
}
