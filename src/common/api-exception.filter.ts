import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

interface HttpResponse {
  status(statusCode: number): HttpResponse;
  json(body: unknown): void;
}

function hasErrorEnvelope(value: unknown): value is { error: { code: string; message: string } } {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = value.error;
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && 'message' in error && typeof error.message === 'string';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!(exception instanceof HttpException)) {
      this.logger.error('Unhandled request error', exception instanceof Error ? exception.stack : String(exception));
    }

    const exceptionBody = exception instanceof HttpException ? exception.getResponse() : null;
    if (hasErrorEnvelope(exceptionBody)) {
      response.status(status).json(exceptionBody);
      return;
    }

    const message = status >= 500
      ? 'Internal server error'
      : typeof exceptionBody === 'string'
        ? exceptionBody
        : exception instanceof HttpException
          ? exception.message
          : 'Internal server error';

    response.status(status).json({
      error: {
        code: status >= 500 ? 'INTERNAL_ERROR' : (HttpStatus[status] ?? 'HTTP_ERROR'),
        message,
      },
    });
  }
}
