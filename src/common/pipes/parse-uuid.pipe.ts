import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { validate as isUuid } from 'uuid';

@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!isUuid(value)) {
      const name = metadata.data ?? 'parameter';
      throw new BadRequestException(`Invalid ${name}: must be a UUID`);
    }
    return value;
  }
}
