import React from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import SplashScreen from '../screens/SplashScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FeedScreen from '../screens/FeedScreen';
import CupsScreen from '../screens/CupsScreen';
import RankingsScreen from '../screens/RankingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RefereeScreen from '../screens/RefereeScreen';
import AdminScreen from '../screens/AdminScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import RefereeLoginScreen from '../screens/auth/RefereeLoginScreen';
import RefereeSignUpScreen from '../screens/auth/RefereeSignUpScreen';
import TermsScreen from '../screens/auth/TermsScreen';

import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICON_MAP = {
  Feed:     ['football',    'football-outline'],
  Cups:     ['trophy',      'trophy-outline'],
  Rankings: ['stats-chart', 'stats-chart-outline'],
  Profile:  ['person',      'person-outline'],
  Referee:  ['flag',        'flag-outline'],
  Admin:    ['settings',    'settings-outline'],
};

function TabIcon({ name, focused, color }) {
  const [active, inactive] = TAB_ICON_MAP[name] || ['ellipse', 'ellipse-outline'];
  return <Ionicons name={focused ? active : inactive} size={22} color={color} />;
}

const TAB_SCREEN_OPTIONS = {
  tabBarActiveTintColor: colors.gold,
  tabBarInactiveTintColor: colors.gray,
  tabBarStyle: {
    backgroundColor: colors.darkCard,
    borderTopColor: colors.darkBorder,
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarLabelStyle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  headerStyle: { backgroundColor: colors.dark },
  headerShadowVisible: false,
  headerTitleStyle: {
    color: colors.gold,
    fontWeight: '700',
    fontSize: 18,
    letterSpacing: -0.3,
  },
  headerTintColor: colors.gold,
};

// ─── Referee-only tabs ────────────────────────────────────────────────────────
function RefereeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        ...TAB_SCREEN_OPTIONS,
      })}
    >
      <Tab.Screen
        name="Referee"
        component={RefereeScreen}
        options={{ tabBarLabel: 'Referee', headerTitle: 'Referee Panel' }}
      />
    </Tab.Navigator>
  );
}

// ─── Player / Admin tabs ──────────────────────────────────────────────────────
function MainTabs() {
  const { t } = useLanguage();
  const { player } = useAuth();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        ...TAB_SCREEN_OPTIONS,
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ headerTitle: 'Urban PL', tabBarLabel: t('nav.feed') }} />
      <Tab.Screen name="Cups" component={CupsScreen} options={{ tabBarLabel: t('nav.cups') }} />
      <Tab.Screen name="Rankings" component={RankingsScreen} options={{ tabBarLabel: t('nav.rankings') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: t('nav.profile') }} />
      {player?.is_admin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{ tabBarLabel: 'Admin', headerTitle: 'Admin Panel' }}
        />
      )}
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="RefereeLogin" component={RefereeLoginScreen} />
      <Stack.Screen name="RefereeSignUp" component={RefereeSignUpScreen} />
    </Stack.Navigator>
  );
}

export default function Navigation() {
  const { session, loading, isPasswordRecovery, player, setPlayer } = useAuth();
  const [splashDone, setSplashDone] = React.useState(false);
  const [onboardingChecked, setOnboardingChecked] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [termsAccepted, setTermsAccepted] = React.useState(false);

  React.useEffect(() => {
    async function check() {
      try {
        const val = Platform.OS === 'web'
          ? localStorage.getItem('hasSeenOnboarding')
          : await SecureStore.getItemAsync('hasSeenOnboarding');
        setShowOnboarding(!val);
      } catch {
        setShowOnboarding(false);
      } finally {
        setOnboardingChecked(true);
      }
    }
    check();
  }, []);

  // Show splash first — auth + onboarding checks run in background
  if (!splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  if (loading || !onboardingChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  if (showOnboarding) {
    return <OnboardingScreen onDone={() => setShowOnboarding(false)} />;
  }

  const isReferee = player?.role === 'Referee';
  const needsTerms = session && player && !player.terms_accepted_at && !termsAccepted;

  return (
    <NavigationContainer>
      {isPasswordRecovery
        ? <ResetPasswordScreen />
        : session
          ? needsTerms
            ? <TermsScreen onAccepted={() => setTermsAccepted(true)} />
            : isReferee ? <RefereeTabs /> : <MainTabs />
          : <AuthStack />
      }
    </NavigationContainer>
  );
}
