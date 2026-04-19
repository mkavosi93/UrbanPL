import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';

export default function RefereeLoginScreen({ navigation }) {
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Missing Fields', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      Alert.alert('Sign In Failed', error.message);
      return;
    }

    // Verify this account has referee access
    const { data: playerData } = await supabase
      .from('players')
      .select('is_referee, is_admin')
      .eq('id', data.user.id)
      .single();

    if (!playerData?.is_referee && !playerData?.is_admin) {
      await supabase.auth.signOut();
      Alert.alert(
        'Access Denied',
        'This account does not have referee privileges. Contact the admin.'
      );
    }
    // If access is valid, AuthContext will handle the session and navigate to MainTabs
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.badge}>🟨</Text>
          <Text style={styles.title}>Referee Portal</Text>
          <Text style={styles.subtitle}>Urban PL · Officials Only</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="your@email.com"
            placeholderTextColor={colors.gray}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="••••••••"
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
              : <Text style={styles.btnText}>Sign In as Referee</Text>
            }
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>New referee?</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => navigation.navigate('RefereeSignUp')}
          >
            <Text style={styles.outlineBtnText}>Create Referee Account →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backLink}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.backLinkText}>← Back to Player Login</Text>
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
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  badge: { fontSize: 56, marginBottom: spacing.md },
  title: {
    fontSize: 30, fontWeight: 'bold',
    color: colors.gold, letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  subtitle: { color: colors.gray, fontSize: 13 },

  form: { width: '100%' },
  label: {
    color: colors.grayLight, fontSize: 13,
    marginBottom: spacing.xs, marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.darkCard,
    borderWidth: 1, borderColor: colors.darkBorder,
    borderRadius: radius.md,
    color: colors.white, padding: spacing.md, fontSize: 16, width: '100%',
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeBtn: { position: 'absolute', right: spacing.md, top: spacing.md },
  eyeIcon: { fontSize: 18 },

  btn: {
    backgroundColor: colors.gold, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.xl,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },

  divider: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: spacing.xl, gap: spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.darkBorder },
  dividerText: { color: colors.gray, fontSize: 12 },

  outlineBtn: {
    borderWidth: 1, borderColor: colors.gold,
    borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center',
  },
  outlineBtnText: { color: colors.gold, fontWeight: 'bold', fontSize: 15 },

  backLink: { alignItems: 'center', marginTop: spacing.xl },
  backLinkText: { color: colors.gray, fontSize: 14 },
});
