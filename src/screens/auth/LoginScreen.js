import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Alert, Image,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';
import { useLanguage } from '../../context/LanguageContext';

export default function LoginScreen({ navigation }) {
  const { t, language, setLanguage } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleForgotPassword() {
    if (!email) {
      Alert.alert(t('login.enterEmail'), t('login.enterEmailMsg'));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert(t('login.checkEmail'), `${t('login.checkEmailMsg')} ${email}.`);
    }
  }

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert(t('login.missingFields'), t('login.missingFieldsMsg'));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert(t('login.loginFailed'), error.message);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Language Toggle */}
        <View style={styles.langToggle}>
          <TouchableOpacity
            style={[styles.langBtn, language === 'en' && styles.langBtnActive]}
            onPress={() => setLanguage('en')}
          >
            <Text style={[styles.langBtnText, language === 'en' && styles.langBtnTextActive]}>EN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, language === 'es' && styles.langBtnActive]}
            onPress={() => setLanguage('es')}
          >
            <Text style={[styles.langBtnText, language === 'es' && styles.langBtnTextActive]}>ES</Text>
          </TouchableOpacity>
        </View>

        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image
            source={require('../../../assets/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <View style={styles.wordmark}>
            <Text style={styles.wordmarkUrban}>URBAN</Text>
            <Text style={styles.wordmarkPL}>PL</Text>
          </View>
          <Text style={styles.logoSub}>{t('login.tagline')}</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>{t('login.email')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('login.emailPlaceholder')}
            placeholderTextColor={colors.gray}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>{t('login.password')}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder={t('login.passwordPlaceholder')}
              placeholderTextColor={colors.gray}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={colors.dark} />
              : <Text style={styles.btnText}>{t('login.signIn')}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.forgotBtn}
            onPress={handleForgotPassword}
          >
            <Text style={styles.forgotText}>{t('login.forgotPassword')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate('SignUp')}
          >
            <Text style={styles.linkText}>
              {t('login.noAccount')} <Text style={styles.linkHighlight}>{t('login.signUpLink')}</Text>
            </Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>officials</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.refBtn}
            onPress={() => navigation.navigate('RefereeLogin')}
          >
            <Text style={styles.refBtnText}>🟨 Referee Portal →</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.dark },
  container: {
    flexGrow: 1,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoImage: {
    width: 110,
    height: 110,
    marginBottom: spacing.sm,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    marginBottom: spacing.xs,
  },
  wordmarkUrban: {
    fontSize: 36,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 5,
  },
  wordmarkPL: {
    fontSize: 44,
    fontWeight: '900',
    color: colors.gold,
    letterSpacing: -1,
    lineHeight: 44,
  },
  logoSub: {
    fontSize: 11,
    color: colors.gray,
    letterSpacing: 3,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  form: { width: '100%' },
  label: {
    color: colors.grayLight,
    fontSize: 13,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
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
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeBtn: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
  },
  eyeIcon: { fontSize: 18 },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: {
    color: colors.dark,
    fontWeight: 'bold',
    fontSize: 16,
  },
  langToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    backgroundColor: colors.darkCard,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    padding: 3,
    marginBottom: spacing.md,
  },
  langBtn: {
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  langBtnActive: { backgroundColor: colors.gold },
  langBtnText: { color: colors.gray, fontSize: 12, fontWeight: '600' },
  langBtnTextActive: { color: colors.dark, fontWeight: 'bold' },
  forgotBtn: { alignItems: 'center', marginTop: spacing.md },
  forgotText: { color: colors.gold, fontSize: 13 },
  linkBtn: { alignItems: 'center', marginTop: spacing.lg },
  linkText: { color: colors.gray, fontSize: 14 },
  linkHighlight: { color: colors.gold, fontWeight: 'bold' },
  divider: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: spacing.xl, marginBottom: spacing.md, gap: spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.darkBorder },
  dividerText: { color: colors.gray, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  refBtn: {
    borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md, padding: spacing.sm,
    alignItems: 'center',
  },
  refBtnText: { color: colors.gray, fontSize: 14 },
});
