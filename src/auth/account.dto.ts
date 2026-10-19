import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(72) newPassword!: string;
  @IsString() @MinLength(12) @MaxLength(72) confirmNewPassword!: string;
}

export class RequestEmailChangeDto {
  @IsEmail() @MaxLength(254) newEmail!: string;
  @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string;
}

export class VerifyEmailChangeDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) token!: string;
}
