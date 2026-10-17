import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '../shared';

/** An HTTP error that carries a stable machine-readable code. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what = 'Resource') {
    return new AppException(ERROR_CODES.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND);
  }

  static forbidden(message = 'You do not have permission to do this') {
    return new AppException(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppException(ERROR_CODES.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }

  static conflict(message: string, details?: unknown) {
    return new AppException(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT, details);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.BAD_REQUEST, details);
  }

  static tokenInvalid(message = 'This link is invalid or has expired') {
    return new AppException(ERROR_CODES.TOKEN_INVALID, message, HttpStatus.BAD_REQUEST);
  }
}
