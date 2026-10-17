import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ThrottlerException } from '@nestjs/throttler';
import { ERROR_CODES, type ApiErrorBody } from '../shared';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppException } from './app-exception';

const STATUS_CODES: Record<number, string> = {
  400: ERROR_CODES.VALIDATION_FAILED,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.VALIDATION_FAILED,
  429: ERROR_CODES.RATE_LIMITED,
};

/** Renders every error as `{ error: { code, message, details } }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { status, body } = this.toBody(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, path: req.url, method: req.method },
        'Unhandled error while processing request',
      );
    }
    res.status(status).json(body);
  }

  private toBody(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof AppException) {
      return this.make(exception.getStatus(), exception.code, exception.message, exception.details);
    }
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError;
      return this.make(400, ERROR_CODES.VALIDATION_FAILED, 'Validation failed', {
        issues: zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (exception instanceof ThrottlerException) {
      return this.make(429, ERROR_CODES.RATE_LIMITED, 'Too many requests, slow down');
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return this.make(
        status,
        STATUS_CODES[status] ?? (status >= 500 ? ERROR_CODES.INTERNAL : `HTTP_${status}`),
        Array.isArray(message) ? message.join(', ') : message,
      );
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return this.make(409, ERROR_CODES.CONFLICT, 'A record with these values already exists', {
          target: exception.meta?.target,
        });
      }
      if (exception.code === 'P2025') {
        return this.make(404, ERROR_CODES.NOT_FOUND, 'Resource not found');
      }
    }
    return this.make(
      HttpStatus.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL,
      'Something went wrong on our side',
    );
  }

  private make(status: number, code: string, message: string, details?: unknown) {
    return { status, body: { error: { code, message, ...(details ? { details } : {}) } } };
  }
}
