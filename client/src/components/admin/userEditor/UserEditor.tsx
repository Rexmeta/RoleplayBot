import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, ShieldCheck, UserCog } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import {
  ContentEditor, ContentEditorRegion, EditorGroup, Field, FieldGrid, ToggleRow, submitWith, type EditorSectionDef,
} from '@/components/admin/contentEditor';

export interface EditableUser {
  id: string; email: string; name: string; role: 'admin' | 'operator' | 'user'; tier: string; isActive: boolean;
  assignedCompanyId?: string | null; assignedOrganizationId?: string | null; assignedCategoryId?: string | null;
}
type CompanyOption = { id: string; name: string; code?: string | null };
type OrganizationOption = { id: string; name: string; code?: string | null; companyId: string };
type CategoryOption = { id: string; name: string; organizationId?: string | null };

export type UserEditForm = {
  role: string; tier: string; isActive: boolean;
  assignedCompanyId: string | null; assignedOrganizationId: string | null; assignedCategoryId: string | null;
};

/** Restore company/organization from a narrower assignment so the cascading selects show the full path. */
export function initialUserEditForm(user: EditableUser, organizations: OrganizationOption[], categories: CategoryOption[]): UserEditForm {
  let companyId = user.assignedCompanyId || null;
  let orgId = user.assignedOrganizationId || null;
  if (orgId && !companyId) {
    const org = organizations.find(o => o.id === orgId);
    if (org?.companyId) companyId = org.companyId;
  }
  if (user.assignedCategoryId && !orgId) {
    const category = categories.find(c => c.id === user.assignedCategoryId);
    if (category?.organizationId) {
      orgId = category.organizationId;
      const org = organizations.find(o => o.id === orgId);
      if (org?.companyId && !companyId) companyId = org.companyId;
    }
  }
  return {
    role: user.role, tier: user.tier, isActive: user.isActive,
    assignedCompanyId: companyId, assignedOrganizationId: orgId, assignedCategoryId: user.assignedCategoryId || null,
  };
}

/** Diff-only PATCH payload: only fields that differ from the stored user are sent. */
export function buildUserUpdates(user: EditableUser, form: UserEditForm): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (form.role !== user.role) updates.role = form.role;
  if (form.tier !== user.tier) updates.tier = form.tier;
  if (form.isActive !== user.isActive) updates.isActive = form.isActive;
  if (form.assignedCompanyId !== user.assignedCompanyId) updates.assignedCompanyId = form.assignedCompanyId;
  if (form.assignedOrganizationId !== user.assignedOrganizationId) updates.assignedOrganizationId = form.assignedOrganizationId;
  if (form.assignedCategoryId !== user.assignedCategoryId) updates.assignedCategoryId = form.assignedCategoryId;
  return updates;
}

const SECTIONS: readonly EditorSectionDef[] = [
  { id: 'account', label: '역할과 등급', description: '시스템 접근 역할과 사용자 등급을 정합니다.', group: '계정', icon: UserCog },
  { id: 'scope', label: '운영자 권한 범위', description: '운영자가 관리할 수 있는 회사, 조직, 카테고리 범위를 지정합니다.', group: '권한', icon: Building2 },
  { id: 'status', label: '계정 상태', description: '계정 사용 가능 여부를 관리합니다. 비활성 계정은 로그인할 수 없습니다.', group: '상태', icon: ShieldCheck },
];

export function UserEditor(props: {
  user: EditableUser | null; companies: CompanyOption[]; organizations: OrganizationOption[]; categories: CategoryOption[];
  pending: boolean; onClose: () => void;
  onSave: (id: string, updates: Record<string, unknown>) => void; onNoChanges: () => void;
}) {
  const { user, pending, onClose } = props;
  return <Dialog open={!!user} onOpenChange={open => { if (!open && !pending) onClose(); }}>
    {/* Keyed per user: the editor's clean baseline is taken from this user's initialized form only. */}
    {user && <UserEditorContent key={user.id} {...props} user={user} />}
  </Dialog>;
}

function UserEditorContent({ user, companies, organizations, categories, pending, onClose, onSave, onNoChanges }: {
  user: EditableUser; companies: CompanyOption[]; organizations: OrganizationOption[]; categories: CategoryOption[];
  pending: boolean; onClose: () => void; onSave: (id: string, updates: Record<string, unknown>) => void; onNoChanges: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<UserEditForm>(() => initialUserEditForm(user, organizations, categories));
  const isOperator = form.role === 'operator';
  const companyName = companies.find(c => c.id === form.assignedCompanyId)?.name;
  const orgName = organizations.find(o => o.id === form.assignedOrganizationId)?.name;
  const categoryName = categories.find(c => c.id === form.assignedCategoryId)?.name;
  const scopeSummary = !form.assignedCompanyId ? '미지정'
    : !form.assignedOrganizationId ? `회사 전체 (${companyName ?? ''})`
    : !form.assignedCategoryId ? `조직 전체 (${orgName ?? ''})`
    : `카테고리 (${categoryName ?? ''})`;

  const save = () => {
    const updates = buildUserUpdates(user, form);
    if (Object.keys(updates).length === 0) { onNoChanges(); return; }
    onSave(user.id, updates);
  };

  return <ContentEditor testId="dialog-edit-user" title={`${user.name} (${user.email})`} revision={JSON.stringify(form)}
    pending={pending} onClose={onClose} onSubmit={submitWith(save)} isNew={false} sections={SECTIONS}
    breadcrumb={t('systemAdmin.dialogs.editUser.title')} newTitle={t('systemAdmin.dialogs.editUser.title')}
    formId="user-editor-form" saveTestId="button-save-edit" closeTestId="button-cancel-edit">
    <ContentEditorRegion sections="account">
      <EditorGroup title="역할과 등급" description="역할을 운영자에서 다른 역할로 바꿔도 지정된 권한 범위는 그대로 저장되며, 운영자일 때만 적용됩니다.">
        <FieldGrid>
          <Field label={t('systemAdmin.dialogs.editUser.role')} htmlFor="user-edit-role" required>
            <Select value={form.role} onValueChange={role => setForm(prev => ({ ...prev, role }))}>
              <SelectTrigger id="user-edit-role" data-testid="select-edit-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t('systemAdmin.roles.admin')}</SelectItem>
                <SelectItem value="operator">{t('systemAdmin.roles.operator')}</SelectItem>
                <SelectItem value="user">{t('systemAdmin.roles.user')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('systemAdmin.dialogs.editUser.tier')} htmlFor="user-edit-tier" required>
            <Select value={form.tier} onValueChange={tier => setForm(prev => ({ ...prev, tier }))}>
              <SelectTrigger id="user-edit-tier" data-testid="select-edit-tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['bronze', 'silver', 'gold', 'platinum', 'diamond'].map(tier =>
                  <SelectItem key={tier} value={tier}>{t(`systemAdmin.tiers.${tier}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </FieldGrid>
      </EditorGroup>
    </ContentEditorRegion>

    <ContentEditorRegion sections="scope">
      {!isOperator ? (
        <EditorGroup title={t('systemAdmin.dialogs.editUser.permissionScope', '권한 범위 설정')}
          description="권한 범위는 운영자 역할에만 적용됩니다. '역할과 등급'에서 역할을 운영자로 바꾸면 범위를 지정할 수 있습니다.">
          <p className="text-sm text-slate-600">현재 역할: {t(`systemAdmin.roles.${form.role}`)}</p>
        </EditorGroup>
      ) : (
        <EditorGroup title={t('systemAdmin.dialogs.editUser.permissionScope', '권한 범위 설정')}
          description={t('systemAdmin.dialogs.editUser.permissionScopeHint', '회사만 선택하면 해당 회사의 모든 조직/카테고리에 접근 가능합니다. 조직을 선택하면 해당 조직의 모든 카테고리에 접근 가능합니다. 카테고리까지 선택하면 해당 카테고리만 접근 가능합니다.')}>
          <Field label={t('systemAdmin.dialogs.editUser.assignedCompany', '담당 회사')} htmlFor="user-edit-company"
            hint="회사를 바꾸면 하위 조직과 카테고리 선택이 초기화됩니다.">
            <Select value={form.assignedCompanyId || 'none'} onValueChange={value => setForm(prev => ({
              ...prev, assignedCompanyId: value === 'none' ? null : value, assignedOrganizationId: null, assignedCategoryId: null,
            }))}>
              <SelectTrigger id="user-edit-company" data-testid="select-edit-company">
                <SelectValue placeholder={t('systemAdmin.dialogs.editUser.selectCompany', '회사를 선택하세요')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('systemAdmin.dialogs.editUser.noAssignment', '미지정')}</SelectItem>
                {companies.map(company => <SelectItem key={company.id} value={company.id}>{company.name} {company.code && `(${company.code})`}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {form.assignedCompanyId && (
            <Field label={t('systemAdmin.dialogs.editUser.assignedOrganization', '담당 조직')} htmlFor="user-edit-org" optional
              hint="조직을 바꾸면 카테고리 선택이 초기화됩니다.">
              <Select value={form.assignedOrganizationId || 'none'} onValueChange={value => setForm(prev => ({
                ...prev, assignedOrganizationId: value === 'none' ? null : value, assignedCategoryId: null,
              }))}>
                <SelectTrigger id="user-edit-org" data-testid="select-edit-organization">
                  <SelectValue placeholder={t('systemAdmin.dialogs.editUser.selectOrganization', '조직을 선택하세요')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('systemAdmin.dialogs.editUser.allOrganizations', '전체 조직 (회사 레벨)')}</SelectItem>
                  {organizations.filter(org => org.companyId === form.assignedCompanyId).map(org =>
                    <SelectItem key={org.id} value={org.id}>{org.name} {org.code && `(${org.code})`}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          {form.assignedCompanyId && form.assignedOrganizationId && (
            <Field label={t('systemAdmin.dialogs.editUser.assignedCategory', '담당 카테고리')} htmlFor="user-edit-category" optional>
              <Select value={form.assignedCategoryId || 'none'} onValueChange={value => setForm(prev => ({
                ...prev, assignedCategoryId: value === 'none' ? null : value,
              }))}>
                <SelectTrigger id="user-edit-category" data-testid="select-edit-category">
                  <SelectValue placeholder={t('systemAdmin.dialogs.editUser.selectCategory', '카테고리를 선택하세요')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('systemAdmin.dialogs.editUser.allCategories', '전체 카테고리 (조직 레벨)')}</SelectItem>
                  {categories.filter(cat => cat.organizationId === form.assignedOrganizationId).map(cat =>
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800" data-testid="user-edit-scope-summary">
            <strong>현재 권한 범위:</strong> {scopeSummary}
          </p>
        </EditorGroup>
      )}
    </ContentEditorRegion>

    <ContentEditorRegion sections="status">
      <EditorGroup title={t('systemAdmin.dialogs.editUser.accountStatus')}>
        <ToggleRow id="user-edit-active" testId="switch-edit-active" label={t('systemAdmin.dialogs.editUser.accountStatus')}
          description={t('systemAdmin.dialogs.editUser.accountStatusHint')} checked={form.isActive}
          onCheckedChange={isActive => setForm(prev => ({ ...prev, isActive }))} />
      </EditorGroup>
    </ContentEditorRegion>
  </ContentEditor>;
}
