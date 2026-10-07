export type UserRoleDto = 'student' | 'instructor' | 'admin';

export interface UserRegisterDto {
  email: string;
  name: string;
  surname: string;
  password: string;
  role: UserRoleDto;
}

export interface RegisterResponseUserDto {
  id: number;
  email: string;
}

export interface RegisterResponseDto {
  user: RegisterResponseUserDto;
  access_token: string;
  token_type: string;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface LoginResponseDto {
  access_token: string;
}

export interface ForgotPasswordRequestDto {
  email: string;
}

export interface ResetPasswordRequestDto {
  token: string;
  new_password: string;
}

export interface MessageResponseDto {
  message: string;
}

export interface UserProfileDto {
  email: string;
  name: string;
  surname: string;
  role: UserRoleDto;
  birthday: string | null;
  phone_number: string | null;
  created_at: string;
}
