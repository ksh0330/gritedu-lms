/**
 * 입력 검증 유틸리티 함수
 */

/**
 * 이름 검증 (한글, 영문, 공백만 허용)
 * @param {string} name - 검증할 이름
 * @returns {object} {valid: boolean, message: string}
 */
export function validateName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: '이름을 입력해주세요.' };
  }

  const trimmed = name.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, message: '이름을 입력해주세요.' };
  }

  if (trimmed.length < 2) {
    return { valid: false, message: '이름은 2자 이상 입력해주세요.' };
  }

  if (trimmed.length > 20) {
    return { valid: false, message: '이름은 20자 이하로 입력해주세요.' };
  }

  // 한글, 영문(대소문자), 공백만 허용
  const nameRegex = /^[가-힣a-zA-Z\s]+$/;
  
  if (!nameRegex.test(trimmed)) {
    return { valid: false, message: '이름은 한글 또는 영문만 입력 가능합니다.' };
  }

  // 연속된 공백 체크
  if (/\s{2,}/.test(trimmed)) {
    return { valid: false, message: '연속된 공백은 사용할 수 없습니다.' };
  }

  return { valid: true, message: '' };
}

/**
 * 전화번호 검증 (한국 형식만 허용)
 * @param {string} phone - 검증할 전화번호 (하이픈 포함/미포함 모두 가능)
 * @returns {object} {valid: boolean, message: string, normalized: string}
 */
export function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, message: '전화번호를 입력해주세요.', normalized: '' };
  }

  // 숫자만 추출
  const digitsOnly = phone.replace(/[^\d]/g, '');
  
  if (digitsOnly.length === 0) {
    return { valid: false, message: '전화번호를 입력해주세요.', normalized: '' };
  }

  // 한국 전화번호 형식 체크 (010, 011, 016, 017, 018, 019로 시작)
  const koreanMobileRegex = /^(010|011|016|017|018|019)\d{7,8}$/;
  
  if (!koreanMobileRegex.test(digitsOnly)) {
    return { valid: false, message: '올바른 한국 휴대폰 번호 형식이 아닙니다. (010-XXXX-XXXX)', normalized: '' };
  }

  // 길이 체크 (10자리 또는 11자리)
  if (digitsOnly.length !== 10 && digitsOnly.length !== 11) {
    return { valid: false, message: '전화번호는 10자리 또는 11자리여야 합니다.', normalized: '' };
  }

  // 정규화된 형식으로 변환 (010-XXXX-XXXX)
  const normalized = formatKoreanPhone(digitsOnly);

  return { valid: true, message: '', normalized };
}

/**
 * 한국 전화번호 포맷팅 (010-XXXX-XXXX)
 * @param {string} phone - 숫자만 포함된 전화번호
 * @returns {string} 포맷팅된 전화번호
 */
export function formatKoreanPhone(phone) {
  const digitsOnly = phone.replace(/[^\d]/g, '');
  
  if (digitsOnly.length === 10) {
    // 010-1234-5678 형식
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 7)}-${digitsOnly.slice(7)}`;
  } else if (digitsOnly.length === 11) {
    // 010-1234-5678 형식
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 7)}-${digitsOnly.slice(7)}`;
  }
  
  return phone;
}

/**
 * 자녀 이름 검증 (학생 이름과 동일한 규칙)
 * @param {string} name - 검증할 자녀 이름
 * @returns {object} {valid: boolean, message: string}
 */
export function validateChildName(name) {
  return validateName(name);
}

/**
 * 비밀번호 검증 (영문, 숫자, 특수문자 필수)
 * 통일된 정규식: 영문, 숫자, 특수문자를 각각 포함하여 8자 이상
 * 사용 가능한 특수문자: ! @ # $ % & * _ ; : , . \ / ?
 * @param {string} password - 검증할 비밀번호
 * @returns {object} {valid: boolean, message: string}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: '비밀번호를 입력해주세요.' };
  }

  const trimmed = password.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, message: '비밀번호를 입력해주세요.' };
  }

  if (trimmed.length < 8) {
    return { valid: false, message: '비밀번호는 8자 이상이어야 합니다.' };
  }

  // 영문, 숫자, 특수문자를 각각 포함하여 8자 이상
  // 사용 가능한 특수문자: ! @ # $ % & * _ ; : , . \ / ?
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%&*_;:,.\/?])[A-Za-z\d!@#$%&*_;:,.\/?]{8,}$/;
  
  if (!passwordRegex.test(trimmed)) {
    // 어떤 조건이 부족한지 구체적으로 알려주기
    if (!/[A-Za-z]/.test(trimmed)) {
      return { valid: false, message: '비밀번호에 영문자를 포함해주세요.' };
    }
    if (!/\d/.test(trimmed)) {
      return { valid: false, message: '비밀번호에 숫자를 포함해주세요.' };
    }
    if (!/[!@#$%&*_;:,.\/?]/.test(trimmed)) {
      return { valid: false, message: '비밀번호에 특수문자를 포함해주세요. 사용 가능한 특수문자: ! @ # $ % & * _ ; : , . \\ / ?' };
    }
    // 허용되지 않는 특수문자가 있는 경우
    if (/[^A-Za-z\d!@#$%&*_;:,.\/?]/.test(trimmed)) {
      return { valid: false, message: '사용할 수 없는 문자가 포함되어 있습니다. 사용 가능한 특수문자: ! @ # $ % & * _ ; : , . \\ / ?' };
    }
    return { valid: false, message: '비밀번호는 영문, 숫자, 특수문자를 각각 포함하여 8자 이상이어야 합니다.' };
  }

  return { valid: true, message: '' };
}

/**
 * 비밀번호 확인 검증
 * @param {string} password - 원본 비밀번호
 * @param {string} passwordConfirm - 확인 비밀번호
 * @returns {object} {valid: boolean, message: string}
 */
export function validatePasswordConfirm(password, passwordConfirm) {
  if (!passwordConfirm || typeof passwordConfirm !== 'string') {
    return { valid: false, message: '비밀번호 확인을 입력해주세요.' };
  }

  if (passwordConfirm.trim().length === 0) {
    return { valid: false, message: '비밀번호 확인을 입력해주세요.' };
  }

  if (password !== passwordConfirm) {
    return { valid: false, message: '비밀번호가 일치하지 않습니다.' };
  }

  return { valid: true, message: '' };
}
