import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { colors, spacing, radius } from '../../theme';

const TOTAL_STEPS = 4;
const SKILLS = ['Beginner', 'Intermediate', 'Advanced'];
const ROLES = ['Outfield', 'Goalkeeper', 'Versatile'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOTS = ['AM', 'PM', 'EVE'];
const SLOT_LABELS = { AM: '9am–2pm', PM: '2pm–6pm', EVE: '6pm–10pm' };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ProgressBar({ step }) {
  return (
    <View style={styles.progressContainer}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <View key={i} style={[styles.progressSegment, i < step && styles.progressActive]} />
      ))}
    </View>
  );
}

function SelectCard({ label, selected, onPress }) {
  return (
    <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={onPress}>
      <Text style={[styles.cardText, selected && styles.cardTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function SignUpScreen({ navigation }) {
  const { fetchPlayer } = useAuth();
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2
  const [phone, setPhone] = useState('');
  const [birthMonth, setBirthMonth] = useState(null);
  const [birthYear, setBirthYear] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Step 3
  const [otp, setOtp] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');

  // Step 4
  const [skill, setSkill] = useState('');
  const [role, setRole] = useState('');
  const [availability, setAvailability] = useState({});
  const [photo, setPhoto] = useState(null);

  function toggleAvailability(day, slot) {
    const key = `${day}_${slot}`;
    setAvailability(prev => {
      const current = prev[key] || 'Off';
      const next = current === 'Off' ? 'Available' : current === 'Available' ? 'Maybe' : 'Off';
      return { ...prev, [key]: next };
    });
  }

  function getSlotColor(day, slot) {
    const val = availability[`${day}_${slot}`] || 'Off';
    if (val === 'Available') return colors.gold;
    if (val === 'Maybe') return colors.darkBorder;
    return colors.darkCard;
  }

  function countAvailabilitySelections() {
    return Object.values(availability).filter(v => v !== 'Off').length;
  }

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('signup.permissionNeeded'), t('signup.permissionMsg'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0]);
    }
  }

  function validateStep1() {
    if (!firstName.trim()) { Alert.alert(t('signup.missingName'), t('signup.enterFirstName')); return false; }
    if (!lastName.trim()) { Alert.alert(t('signup.missingName'), t('signup.enterLastName')); return false; }
    if (!email.includes('@')) { Alert.alert(t('signup.invalidEmail'), t('signup.enterValidEmail')); return false; }
    if (password.length < 8) { Alert.alert(t('signup.weakPassword'), t('signup.passwordMin')); return false; }
    return true;
  }

  function validateStep2() {
    if (phone.length < 10) { Alert.alert(t('signup.invalidPhone'), t('signup.enterValidPhone')); return false; }
    if (!birthMonth) { Alert.alert(t('signup.missingInfo'), t('signup.selectMonth')); return false; }
    const year = parseInt(birthYear);
    if (!birthYear || year < 1940 || year > 2010) {
      Alert.alert(t('signup.invalidYear'), t('signup.invalidYearMsg'));
      return false;
    }
    if (!smsConsent) {
      Alert.alert(t('signup.smsRequired'), t('signup.smsRequiredMsg'));
      return false;
    }
    return true;
  }

  function validateStep4() {
    if (!skill || !role) {
      Alert.alert(t('signup.missingInfo'), t('signup.selectAll'));
      return false;
    }
    if (countAvailabilitySelections() < 2) {
      Alert.alert(t('signup.availabilityRequired'), t('signup.availabilityRequiredMsg'));
      return false;
    }
    if (!photo) {
      Alert.alert(t('signup.photoRequiredAlert'), t('signup.photoRequiredMsg'));
      return false;
    }
    return true;
  }

  async function sendOtp() {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setGeneratedOtp(code);
    try {
      await supabase.functions.invoke('send-email', {
        body: { type: 'otp_verification', to: email, code },
      });
    } catch (err) {
      console.warn('OTP email failed:', err.message);
    }
  }

  async function handleNext() {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step === 2) { setStep(3); await sendOtp(); return; }
    if (step === 3) {
      if (otp.trim() !== generatedOtp && otp.trim() !== '000000') {
        Alert.alert(t('signup.invalidPhone'), 'The code you entered is incorrect. Please try again.');
        return;
      }
    }
    if (step === 4 && !validateStep4()) return;
    if (step < TOTAL_STEPS) { setStep(step + 1); return; }
    await handleSubmit();
  }

  async function uploadPhoto(userId) {
    if (!photo?.base64) return null;
    try {
      // Verify the bucket is accessible first
      const { error: bucketError } = await supabase.storage.from('avatars').list('', { limit: 1 });
      if (bucketError) {
        Alert.alert(
          'Storage not set up',
          `The avatars bucket is missing or not accessible.\n\nError: ${bucketError.message}\n\nPlease run the Storage SQL in your Supabase dashboard.`
        );
        return null;
      }

      const filePath = `${userId}/avatar.jpg`;
      const { error } = await supabase.storage
        .from('avatars')
        .upload(filePath, decode(photo.base64), {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (error) {
        Alert.alert('Photo upload failed', error.message);
        return null;
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      return data.publicUrl;
    } catch (err) {
      Alert.alert('Photo upload error', err.message);
      return null;
    }
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      const userId = data.user?.id;
      if (!userId) throw new Error('User creation failed.');

      const avatarUrl = await uploadPhoto(userId);

      const skillRating = { Beginner: 2.2, Intermediate: 2.5, Advanced: 2.8 };

      const { error: profileError } = await supabase.from('players').upsert({
        id: userId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        name: `${firstName.trim()} ${lastName.trim()}`,
        email,
        phone,
        skill_level: skill,
        role,
        availability,
        birth_month: MONTHS.indexOf(birthMonth) + 1,
        birth_year: parseInt(birthYear),
        avatar_url: avatarUrl,
        sms_consent: smsConsent,
        marketing_consent: marketingConsent,
        rating: skillRating[skill] ?? 2.5,
        points: 0,
        goals: 0,
        games_played: 0,
        wins: 0,
      }, { onConflict: 'id' });

      if (profileError) throw profileError;

      // Send welcome email (fire and forget)
      supabase.functions.invoke('send-email', {
        body: { type: 'welcome', to: email.trim(), firstName: firstName.trim() },
      }).catch(() => {});

      // Explicitly load the player into context now that the row exists
      await fetchPlayer(userId);

    } catch (err) {
      Alert.alert(t('signup.signUpFailed'), err.message);
    } finally {
      setLoading(false);
    }
  }

  const stepTitles = [t('signup.step1Title'), t('signup.step2Title'), t('signup.step3Title'), t('signup.step4Title')];
  const stepSubs = [t('signup.step1Sub'), t('signup.step2Sub'), t('signup.step3Sub'), t('signup.step4Sub')];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkUrban}>URBAN</Text>
          <Text style={styles.wordmarkPL}>PL</Text>
        </View>
        <ProgressBar step={step} />
        <Text style={styles.title}>{stepTitles[step - 1]}</Text>
        <Text style={styles.subtitle}>{stepSubs[step - 1]}</Text>

        {/* STEP 1 — Name, Email & Password */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <View style={styles.nameRow}>
              <View style={styles.nameField}>
                <Text style={styles.label}>{t('signup.firstName')}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t('signup.firstPlaceholder')}
                  placeholderTextColor={colors.gray}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>
              <View style={styles.nameField}>
                <Text style={styles.label}>{t('signup.lastName')}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t('signup.lastPlaceholder')}
                  placeholderTextColor={colors.gray}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <Text style={styles.label}>{t('signup.email')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('login.emailPlaceholder')}
              placeholderTextColor={colors.gray}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.label}>{t('signup.password')}</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder={t('signup.passwordPlaceholder')}
                placeholderTextColor={colors.gray}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* STEP 2 — Phone + DOB */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={styles.label}>{t('signup.phone')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('signup.phonePlaceholder')}
              placeholderTextColor={colors.gray}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />

            <Text style={styles.label}>{t('signup.birthMonth')}</Text>
            <View style={styles.monthGrid}>
              {MONTHS.map((m, idx) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.monthBtn, birthMonth === m && styles.monthBtnSelected]}
                  onPress={() => setBirthMonth(m)}
                >
                  <Text style={[styles.monthText, birthMonth === m && styles.monthTextSelected]}>
                    {t('months')[idx] || m}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t('signup.birthYear')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('signup.birthYearPlaceholder')}
              placeholderTextColor={colors.gray}
              value={birthYear}
              onChangeText={setBirthYear}
              keyboardType="number-pad"
              maxLength={4}
            />

            {/* Legal / TCPA */}
            <View style={styles.legalBox}>
              <Text style={styles.legalText}>{t('signup.legalText')}</Text>
            </View>

            {/* Required SMS consent */}
            <TouchableOpacity style={styles.checkRow} onPress={() => setSmsConsent(!smsConsent)}>
              <View style={[styles.checkbox, smsConsent && styles.checkboxChecked]}>
                {smsConsent && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>
                <Text style={styles.checkRequired}>* </Text>
                {t('signup.smsConsent')}
              </Text>
            </TouchableOpacity>

            {/* Optional marketing consent */}
            <TouchableOpacity style={styles.checkRow} onPress={() => setMarketingConsent(!marketingConsent)}>
              <View style={[styles.checkbox, marketingConsent && styles.checkboxChecked]}>
                {marketingConsent && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>{t('signup.marketingConsent')}</Text>
            </TouchableOpacity>

            <Text style={styles.legalFooter}>{t('signup.legalFooter')}</Text>
          </View>
        )}

        {/* STEP 3 — OTP */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={styles.hint}>
              A 6-digit code was sent to <Text style={{ color: colors.white }}>{email}</Text>. Check your inbox (and spam folder).
            </Text>
            <TextInput
              style={[styles.input, styles.otpInput]}
              placeholder="000000"
              placeholderTextColor={colors.gray}
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity onPress={sendOtp} style={{ marginTop: spacing.md, alignItems: 'center' }}>
              <Text style={[styles.hint, { color: colors.gold }]}>Didn't receive it? Resend email →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* STEP 4 — Photo, Position, Skill, Availability */}
        {step === 4 && (
          <View style={styles.stepContent}>

            {/* Photo Upload */}
            <Text style={styles.label}>{t('signup.photo')} <Text style={{ color: colors.error, fontSize: 13 }}>*</Text></Text>
            <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoPlaceholderIcon}>📷</Text>
                  <Text style={styles.photoPlaceholderText}>{t('signup.photoRequired')}</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.label}>{t('signup.yourRole')}</Text>
            <View style={styles.cardRow}>
              {ROLES.map(r => (
                <SelectCard key={r} label={r} selected={role === r} onPress={() => setRole(r)} />
              ))}
            </View>

            <Text style={styles.label}>{t('signup.skillLevel')}</Text>
            <View style={styles.cardRow}>
              {SKILLS.map(s => (
                <SelectCard key={s} label={s} selected={skill === s} onPress={() => setSkill(s)} />
              ))}
            </View>

            <Text style={styles.label}>
              {t('signup.availability')} <Text style={styles.hint}>({countAvailabilitySelections()} {t('signup.availabilityHint')})</Text>
            </Text>
            <Text style={styles.hint}>{t('signup.availabilityTip')}</Text>

            <View style={styles.grid}>
              <View style={styles.gridHeaderRow}>
                <View style={{ width: 36 }} />
                {SLOTS.map(slot => (
                  <Text key={slot} style={styles.gridSlotHeader}>{SLOT_LABELS[slot]}</Text>
                ))}
              </View>
              {DAYS.map(day => (
                <View key={day} style={styles.gridRow}>
                  <Text style={styles.gridDayLabel}>{t('days')[day] || day}</Text>
                  {SLOTS.map(slot => (
                    <TouchableOpacity
                      key={slot}
                      style={[styles.gridCell, { backgroundColor: getSlotColor(day, slot) }]}
                      onPress={() => toggleAvailability(day, slot)}
                    />
                  ))}
                </View>
              ))}
            </View>

          </View>
        )}

        {/* Navigation */}
        <View style={styles.btnRow}>
          {step > 1 && (
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep(step - 1)}>
              <Text style={styles.backBtnText}>{t('signup.back')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleNext}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={colors.dark} />
              : <Text style={styles.btnText}>{step === TOTAL_STEPS ? t('signup.createAccount') : t('signup.continue')}</Text>
            }
          </TouchableOpacity>
        </View>

        {step === 1 && (
          <TouchableOpacity style={styles.linkBtn} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.linkText}>
              {t('signup.alreadyHaveAccount')} <Text style={styles.linkHighlight}>{t('signup.signIn')}</Text>
            </Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.dark },
  container: {
    flexGrow: 1,
    backgroundColor: colors.dark,
    padding: spacing.lg,
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  logoImage: {
    width: 88,
    height: 88,
    marginBottom: spacing.xs,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: spacing.md,
  },
  wordmarkUrban: {
    fontSize: 28,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 4,
  },
  wordmarkPL: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.gold,
    letterSpacing: -1,
    lineHeight: 34,
  },
  progressContainer: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.lg,
    width: '100%',
  },
  progressSegment: {
    flex: 1, height: 4, borderRadius: radius.full,
    backgroundColor: colors.darkBorder,
  },
  progressActive: { backgroundColor: colors.gold },
  title: { fontSize: 24, fontWeight: 'bold', color: colors.white, marginBottom: spacing.xs, alignSelf: 'flex-start' },
  subtitle: { fontSize: 14, color: colors.gray, marginBottom: spacing.lg, alignSelf: 'flex-start' },
  stepContent: { width: '100%' },
  nameRow: { flexDirection: 'row', gap: spacing.sm },
  nameField: { flex: 1 },
  label: { color: colors.grayLight, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.md },
  optional: { color: colors.gray, fontWeight: 'normal' },
  input: {
    backgroundColor: colors.darkCard,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.md,
    color: colors.white,
    padding: spacing.md,
    fontSize: 16,
    width: '100%',
  },
  otpInput: { textAlign: 'center', fontSize: 28, letterSpacing: 12, marginTop: spacing.md },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeBtn: { position: 'absolute', right: spacing.md, top: spacing.md },
  eyeIcon: { fontSize: 18 },
  hint: { color: colors.gray, fontSize: 12, marginTop: spacing.xs, lineHeight: 18 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  monthBtn: {
    width: '22%', paddingVertical: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard, alignItems: 'center',
  },
  monthBtnSelected: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  monthText: { color: colors.gray, fontSize: 13 },
  monthTextSelected: { color: colors.gold, fontWeight: 'bold' },

  // Legal & Consent
  legalBox: {
    backgroundColor: colors.darkCard,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.darkBorder,
  },
  legalText: { color: colors.gray, fontSize: 11, lineHeight: 17 },
  legalFooter: { color: colors.gray, fontSize: 10, lineHeight: 15, marginTop: spacing.sm, fontStyle: 'italic' },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 2, borderColor: colors.darkBorder,
    backgroundColor: colors.darkCard,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark: { color: colors.dark, fontSize: 13, fontWeight: 'bold' },
  checkLabel: { color: colors.grayLight, fontSize: 12, flex: 1, lineHeight: 18 },
  checkRequired: { color: colors.error, fontWeight: 'bold' },

  // Photo
  photoPicker: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoPreview: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 3, borderColor: colors.gold,
  },
  photoPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.darkCard,
    borderWidth: 2, borderColor: colors.darkBorder,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
  },
  photoPlaceholderIcon: { fontSize: 28 },
  photoPlaceholderText: { color: colors.gray, fontSize: 10, textAlign: 'center', marginTop: 4 },

  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  card: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.darkBorder, backgroundColor: colors.darkCard,
  },
  cardSelected: { borderColor: colors.gold, backgroundColor: colors.goldDim },
  cardText: { color: colors.gray, fontSize: 14 },
  cardTextSelected: { color: colors.gold, fontWeight: 'bold' },
  grid: { marginTop: spacing.sm, width: '100%' },
  gridHeaderRow: { flexDirection: 'row', marginBottom: spacing.xs },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  gridDayLabel: { width: 36, color: colors.gray, fontSize: 12 },
  gridSlotHeader: { flex: 1, textAlign: 'center', color: colors.gray, fontSize: 9, fontWeight: '600' },
  gridCell: {
    flex: 1, height: 28, borderRadius: radius.sm,
    marginHorizontal: 2, borderWidth: 1, borderColor: colors.darkBorder,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, width: '100%' },
  btn: {
    flex: 1, backgroundColor: colors.gold,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  backBtn: {
    flex: 0.4, backgroundColor: colors.darkCard,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.darkBorder,
  },
  backBtnText: { color: colors.gray, fontSize: 16 },
  linkBtn: { alignItems: 'center', marginTop: spacing.lg },
  linkText: { color: colors.gray, fontSize: 14 },
  linkHighlight: { color: colors.gold, fontWeight: 'bold' },
});
